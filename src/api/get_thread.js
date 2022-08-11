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
	let boardCode = req.query.board_code;
	let opId = req.query.op_id;
	
	let boards = await mysql.query(
		`SELECT * FROM boards
		 WHERE board_code=? AND expiration_date_ms>?`,
		[boardCode, +new Date()]
	);
	if (!boards.length) {
		res.status(404).send("Not found");
		return;
	}
	
	let posts = await mysql.query(
		`SELECT board_code, post_id, timestamp_ms, text_ct, parent_post_id, writers_only, mod_status, author FROM posts
		 WHERE board_code=? AND (post_id=? OR parent_post_id=?)
		 ORDER BY timestamp_ms ASC`,
		[boardCode, opId, opId]
	);
	
	mysql.end();

	let board = boards[0];
	delete board.writing_key_hash;
	board.moderated = !!board.owner_key_hash;
	delete board.owner_key_hash;

	res.send(JSON.stringify({
		board: board,
		posts: posts
	}));
};
