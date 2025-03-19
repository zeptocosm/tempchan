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
		"SELECT * FROM boards WHERE board_code=? AND (expiration_date_ms=0 OR expiration_date_ms>?)",
		[boardCode, now]
	);
	console.log("SELECT * FROM boards:", boardsResult);
	if (!boardsResult.length) {
		res.status(400).send("Invalid board_code");
		mysql.end();
		return;
	}
	let board = boardsResult[0];

	let writingKeyHash = board.writing_key_hash;
	if (writingKeyHash && !verifyPassword(body.writing_key, writingKeyHash)) {
		res.status(403).send("Invalid writing_key");
		mysql.end();
		return;
	}

	let author = 0;
	if (body.author && ownerKey) {
		let ownerKeyHash = board.owner_key_hash;
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

	if (parentPostId) {
		// parent post must exist and have no parent of its own
		let parentLookup = await mysql.query(
			`SELECT COUNT(1) AS c FROM posts WHERE board_code=? AND post_id=? AND parent_post_id=0`,
			[boardCode, parentPostId]
		);
		console.log("parentLookup:", parentLookup);
		if (!parentLookup[0]["c"]) {
			res.status(400).send("Invalid parent_post_id");
			mysql.end();
			return;
		}
	}

	let isRolling = !!board.rolling_lifespan_ms;

	let insertPostResult = await mysql.transaction()
		.query(`SET @X = (SELECT last_post_id FROM boards where board_code=?)`, [boardCode])
		.query("UPDATE boards SET last_post_id=@X+1"+(isRolling?", expiration_date_ms=0":"")+" WHERE board_code=?", [boardCode])
		.query(`INSERT INTO posts (board_code, text_ct, parent_post_id, timestamp_ms, post_id,   writers_only,      author)
			 VALUES (?,?,?,?,@X+1,?,?);`,
			                 [     boardCode,  textCt,  parentPostId,   now, /*post_id = @X+1,*/ body.writers_only, author?1:0])
		.commit();
	console.log("SET @X, UPDATE boards, INSERT INTO posts:", insertPostResult);
	let insertedId = insertPostResult[2].insertId;
	let getInsertedPostResult = await mysql.query(`SELECT post_id FROM posts WHERE incrementing_id=?`, [insertedId]);
	console.log("SELECT FROM posts:", getInsertedPostResult);

	mysql.end();
	res.send(getInsertedPostResult[0].post_id);
};
