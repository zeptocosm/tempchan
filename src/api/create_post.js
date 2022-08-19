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
	let boardCode = body.board_code;
	let textCt = body.text_ct;
	if (!textCt) {
		res.status(400).send("Missing text_ct");
		mysql.end();
		return;
	}
	if (textCt.length > 40000) {
		res.status(400).send("text_ct too large");
		mysql.end();
		return;
	}
	let parentPostId = body.parent_post_id || 0;
	let ownerKey = body.owner_key;
	
	let now = +new Date();
	
	// Check to make sure the board exists and hasn't expired
	let boardsResult = await mysql.query(
		"SELECT * FROM boards WHERE board_code=? AND expiration_date_ms>?",
		[boardCode, now]
	);
	console.log("SELECT * FROM boards:", boardsResult);
	if (!boardsResult.length) {
		res.status(400).send("Invalid board_code");
		mysql.end();
		return;
	}

	let writingKeyHash = boardsResult[0].writing_key_hash;
	if (writingKeyHash && !verifyPassword(body.writing_key, writingKeyHash)) {
		res.status(403).send("Invalid writing_key");
		mysql.end();
		return;
	}

	let author = 0;
	if (body.author && ownerKey) {
		let ownerKeyHash = boardsResult[0].owner_key_hash;
		if (!ownerKeyHash) {
			res.status(403).send("Cannot authenticate on unmoderated board");
			mysql.end();
			return;
		}
		if (!verifyPassword(ownerKey, ownerKeyHash)) {
			res.status(403).send("Invalid owner_key");
			mysql.end();
			return;
		}
		author = body.author;
	}

	// post_id should equal 1 plus the number of already-existing rows with the same
	// board_code value.
	let insertPostResult = await mysql.transaction()
		.query(`SET @X = (SELECT COUNT(1) FROM posts WHERE board_code=?);`, [boardCode])
		.query(`INSERT INTO posts (board_code, text_ct, parent_post_id, timestamp_ms, post_id, writers_only,      author)
			 VALUES (?,?,?,?,@X+1,?,?);`,
			                 [ boardCode,  textCt,  parentPostId,   now,                   body.writers_only, author?1:0])
		.commit();
	console.log("INSERT INTO posts:", insertPostResult);
	let insertedId = insertPostResult[1].insertId;
	let getInsertedPostResult = await mysql.query(`SELECT post_id FROM posts WHERE incrementing_id=?`, [insertedId]);

	mysql.end();
	console.log("SELECT FROM posts:", getInsertedPostResult);
	res.send(getInsertedPostResult[0].post_id);
};
