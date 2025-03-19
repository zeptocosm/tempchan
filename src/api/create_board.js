const fs = require("fs");
const mysql = require("serverless-mysql")({
	config: {
		host     : process.env.ENDPOINT,
		database : process.env.DATABASE,
		user     : process.env.USERNAME,
		password : process.env.PASSWORD,
		ssl : { ca : fs.readFileSync(process.env.CA_PATH || "/etc/pki/tls/certs/ca-bundle.crt") }
	}
});
const sjcl = require("sjcl");
const OWNER_KEY_LENGTH = 16;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// https://altv.stuyk.com/docs/articles/snippets/password-hashing.html
const hashPassword = function(password) {
	const saltBits = sjcl.random.randomWords(2, 0);
	const salt = sjcl.codec.base64.fromBits(saltBits);
	const key = sjcl.codec.base64.fromBits(sjcl.misc.pbkdf2(password, saltBits, 2000, 256));
	return `${key}$${salt}`;
};

const validateAlphabet = function(string) {
	for (let i=0; i<string.length; i++) {
		let c = string.charAt(i);
		if (ALPHABET.indexOf(c) === -1) {
			return false;
		}
	}
	return true;
};

module.exports = async function(req, res) {
	const { body } = req;
	let lifespanDays = parseInt(body.lifespan_days);
	if (isNaN(lifespanDays) ||
		(body.is_rolling && (lifespanDays < 1 || lifespanDays > 21)) ||
		(!body.is_rolling && (lifespanDays < 0 || lifespanDays > 35))
	) {
		res.status(400).send("Invalid lifespan_days");
		mysql.end();
		return;
	}
	
	let expirationDateMs;
	let rollingLifespanMs;
	let now = +new Date();
	if (body.is_rolling) {
		rollingLifespanMs = lifespanDays*MS_PER_DAY;
		expirationDateMs = now + rollingLifespanMs; // this will be erased when the first post is made
	} else {
		// The next GMT midnight after now+lifespan:
		expirationDateMs = +new Date(
			new Date(
				now + (lifespanDays+1)*MS_PER_DAY
			).toISOString().slice(0,10) + "T00:00:00.000Z"
		);
		rollingLifespanMs = 0;
	}

	let titleCt = body.title_ct;
	if (!titleCt) {
		res.status(400).send("Missing title_ct");
		mysql.end();
		return;
	}
	let descriptionCt = body.description_ct;
	if (!descriptionCt) {
		res.status(400).send("Missing description_ct");
		mysql.end();
		return;
	}
	let writingKey = body.writing_key;
	if (!writingKey) {
		res.status(400).send("Missing writing_key");
		return;
	}
	let boardKey = body.board_key;
	if (!boardKey) {
		res.status(400).send("Missing board_key");
		mysql.end();
		return;
	}
	if (!validateAlphabet(boardKey)) {
		res.status(400).send("Invalid board_key");
		mysql.end();
		return;
	}
	let ownerKey = body.owner_key;
	if (ownerKey && (!validateAlphabet(ownerKey) || ownerKey.length !== OWNER_KEY_LENGTH)) {
		res.status(400).send("Invalid owner_key");
		mysql.end();
		return;
	}

	let rows = await mysql.query(
		"SELECT * FROM boards WHERE board_code=?",
		[boardKey]
	);
	if (rows.length) {
		// This is highly unlikely to happen by chance
		res.status(400).send("board_key already exists");
		mysql.end();
		return;
	}
	let writingKeyHash = hashPassword(writingKey);
	let ownerKeyHash = ownerKey ? hashPassword(ownerKey) : null;

	// There's a race condition here but it's very unlikely to happen
	let result = await mysql.query(
		`INSERT INTO boards       (board_code, expiration_date_ms, title_ct, description_ct, writing_key_hash, owner_key_hash, rolling_lifespan_ms, last_post_id)
		 VALUES (?,?,?,?,?,?,?,0)`, [boardKey, expirationDateMs,   titleCt,  descriptionCt,  writingKeyHash,   ownerKeyHash,   rollingLifespanMs]);
	console.log("INSERT INTO boards:", result);
	
	mysql.end()
	res.status(200).send("OK");
};
