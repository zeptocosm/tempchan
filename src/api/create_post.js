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
	let parentPostId = body.parent_post_id || 0;
	
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

	// post_id should equal 1 plus the number of already-existing rows with the same
	// board_code value.
	let insertPostResult = await mysql.query(
		`INSERT INTO posts (board_code, text_ct, parent_post_id, timestamp_ms, post_id, writers_only)
		 VALUES (?,?,?,?,?,?)`,
		 [                  boardCode,  textCt,  parentPostId,   now,          0,       body.writers_only]);
	console.log("INSERT INTO posts:", insertPostResult);
	let insertedIncrementingId = insertPostResult.insertId;

	let postsCountResult = await mysql.query(
		"SELECT COUNT(1) FROM posts WHERE board_code=? AND incrementing_id<?",
		[boardCode, insertedIncrementingId]
	);
	console.log("SELECT COUNT(1) FROM posts:", postsCountResult);

	let postIdToSet = 1+postsCountResult[0]["COUNT(1)"];

	let updatePostResult = await mysql.query(
		"UPDATE posts SET post_id=? WHERE incrementing_id=?",
		[postIdToSet, insertedIncrementingId]
	);

	console.log("UPDATE posts:", updatePostResult);
	
	mysql.end();
	res.send(postIdToSet);
};
