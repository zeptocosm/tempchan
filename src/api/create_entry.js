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

// https://altv.stuyk.com/docs/articles/snippets/password-hashing.html
const verifyPassword = function(password, storedPasswordHash) {
    const [_key, _salt] = storedPasswordHash.split('$');
    const saltBits = sjcl.codec.base64.toBits(_salt);
    const derivedKey = sjcl.misc.pbkdf2(password, saltBits, 2000, 256);
    const derivedBaseKey = sjcl.codec.base64.fromBits(derivedKey);

    if (_key != derivedBaseKey) {
        return false;
    }
    return true;
};

module.exports = async function(req, res) {
	const { body } = req;
	let dirCode = body.dir_code;
	let boardCode = body.board_code;
	if (!boardCode) {
		res.status(400).send("Missing board_code");
		mysql.end();
		return;
	}
	let boardSlugCt = body.board_slug_ct;
	if (!boardSlugCt) {
		res.status(400).send("Missing board_slug_ct");
		mysql.end();
		return;
	}
	if (boardSlugCt.length > 150) {
		res.status(400).send("board_slug_ct too large");
		mysql.end();
		return;
	}

	// Check that the board exists
	let boardsResult = await mysql.query(
		"SELECT COUNT(1) AS c FROM boards WHERE board_code=?",
		[boardCode]
	);
	console.log("SELECT COUNT(1) AS c FROM boards", boardsResult);
	if (!boardsResult[0]["c"]) {
		res.status(400).send("Invalid board_code");
		mysql.end();
		return;
	}
	
	// Check that the directory exists and either has no boards,
	// or has at least one unexpired board

	let dirsResult = await mysql.query(
		"SELECT * FROM directories WHERE dir_code=?",
		[dirCode]
	);
	console.log("SELECT * FROM directories", dirsResult);
	if (!dirsResult.length) {
		res.status(400).send("Invalid dir_code");
		mysql.end();
		return;
	}

	let entriesResult = await mysql.query(
		"SELECT * FROM entries WHERE dir_code=?",
		[dirCode]
	);
	console.log("SELECT * FROM entries:", entriesResult);

	if (entriesResult.length) {
		let entryBoardCodes = [];
		for (let i=0; i<entriesResult.length; i++) {
			let entryBoardCode = entriesResult[i].board_code;
			if (entryBoardCode === boardCode) {
				res.status(400).send("Directory already contains this board");
				mysql.end();
				return;
			}
			entryBoardCodes.push(entryBoardCode);
		}
		let expirationResult = await mysql.query(
			"SELECT MAX(expiration_date_ms) FROM boards WHERE board_code IN (?)",
			[entryBoardCodes]
		);
		console.log("last expiration_date_ms:", expirationResult);
		if (expirationResult[0][Object.keys(expirationResult[0])[0]] < +new Date()) {
			res.status(400).send("Invalid dir_code");
			mysql.end();
			return;
		}
	}

	let writingKeyHash = dirsResult[0].writing_key_hash;
	if (writingKeyHash && !verifyPassword(body.dir_writing_key, writingKeyHash)) {
		res.status(403).send("Invalid writing_key");
		mysql.end();
		return;
	}

	let result = await mysql.query(
		`INSERT INTO entries (dir_code, board_code, board_slug_ct)
		 VALUES (?,?,?)`,    [dirCode,  boardCode,  boardSlugCt]);
	console.log("INSERT INTO entries:", result);
	
	mysql.end();
	res.status(200).send("OK");
};
