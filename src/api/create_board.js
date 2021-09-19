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

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const insecureRandomString = function(length) {
	let string = "";
	for (let i=0; i<length; i++) {
		let index = Math.floor(Math.random() * ALPHABET.length); 
		string += ALPHABET[index];
	}
	return string;
};

module.exports = async function(req, res) {
	const { body } = req;
	let lifespanDays = parseInt(body.lifespan_days);
	if (isNaN(lifespanDays) || lifespanDays < 0 || lifespanDays > 35) {
		res.status(400).send("Invalid lifespan_days");
		return;
	}
	// The next GMT midnight after now+lifespan:
	let expirationDateMs = +new Date(
		new Date(
			+new Date() + (lifespanDays+1)*MS_PER_DAY
		).toISOString().slice(0,10) + "T00:00:00.000Z"
	);

	let titleCt = body.title_ct;
	if (!titleCt) {
		res.status(400).send("Missing title_ct");
		return;
	}
	let descriptionCt = body.description_ct;
	if (!descriptionCt) {
		res.status(400).send("Missing description_ct");
		return;
	}

	let boardCode;
	while (true) {
		boardCode = insecureRandomString(3);
		let rows = await mysql.query(
			"SELECT * FROM boards WHERE board_code=?",
			[boardCode]
		);
		if (!rows.length) {
			break;
		}
	}
	// There's a race condition here but it's very unlikely to happen
	let result = await mysql.query(
		`INSERT INTO boards (board_code, expiration_date_ms, title_ct, description_ct)
		 VALUES (?,?,?,?)`, [boardCode,  expirationDateMs,   titleCt,  descriptionCt]);
	console.log("INSERT INTO boards:", result);
	
	mysql.end()
	res.send(boardCode);
};
