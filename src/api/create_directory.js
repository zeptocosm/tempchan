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

	let writingKey = body.dir_writing_key;
	if (!writingKey) {
		res.status(400).send("Missing writing_key");
		return;
	}
	let dirKey = body.dir_key;
	if (!dirKey) {
		res.status(400).send("Missing dir_key");
		mysql.end();
		return;
	}
	if (!validateAlphabet(dirKey)) {
		res.status(400).send("Invalid dir_key");
		mysql.end();
		return;
	}

	let rows = await mysql.query(
		"SELECT * FROM directories WHERE dir_code=?",
		[dirKey]
	);
	if (rows.length) {
		// This is highly unlikely to happen by chance
		res.status(400).send("dir_key already exists");
		mysql.end();
		return;
	}
	let writingKeyHash = hashPassword(writingKey);

	// There's a race condition here but it's very unlikely to happen
	let result = await mysql.query(
		`INSERT INTO directories (dir_code, writing_key_hash)
		 VALUES (?,?)`,          [dirKey,   writingKeyHash]);
	console.log("INSERT INTO directories:", result);
	
	mysql.end();
	res.status(200).send("OK");
};
