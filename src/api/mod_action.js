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

// Same as on frontend
const stripCiphertext = function(fullCiphertext) {
	return {iv: fullCiphertext.iv, salt: fullCiphertext.salt, ct: fullCiphertext.ct};
};
const encrypt = function(key, plaintext) {
	return JSON.stringify(stripCiphertext(JSON.parse(sjcl.encrypt(key, plaintext))));
};
const decrypt = function(key, ciphertext) {
	let plaintext;
	try {
		plaintext = sjcl.decrypt(key, JSON.stringify(stripCiphertext(JSON.parse(ciphertext))));
	} catch(e) {
		plaintext = "[[Decryption error]]";
		console.log("Decryption error:", e);
	}
	return plaintext;
};

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
	let postId = body.post_id || 0;
	let ownerKey = body.owner_key;
	let setModStatus = body.set_mod_status || 0;

	if (setModStatus !== 0 && setModStatus !== 1) {
		res.status(400).send("Invalid set_mod_status");
		mysql.end();
		return;
	}

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

	// Validate provided owner_key
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

	if (!postId) {
		// No status changes, just a password check
		res.send("Success");
		mysql.end();
		return;
	}

	// TODO get text and encrypt/decrypt it

	let getPostResult = await mysql.query(
		"SELECT text_ct, mod_status FROM posts WHERE board_code=? AND post_id=?",
		[boardCode, postId]
	);
	console.log("SELECT posts:", getPostResult);
	if (getPostResult.length === 0) {
		res.status(400).send("Post not found");
		mysql.end();
		return;
	}
	let post = getPostResult[0];
	let setCiphertext;
	if ((post.mod_status || 0) === setModStatus) {
		res.status(200).send("Nothing to do");
		mysql.end();
		return;
	} else if (setModStatus === 1) {
		setCiphertext = encrypt(ownerKey, post.text_ct);
	} else {
		setCiphertext = decrypt(ownerKey, post.text_ct);
	}

	let updatePostResult = await mysql.query(
		"UPDATE posts SET mod_status=?, text_ct=? WHERE board_code=? AND post_id=?",
		[setModStatus, setCiphertext, boardCode, postId]
	);
	console.log("UPDATE posts:", updatePostResult);
	// TODO: check if any row was updated
	mysql.end();
	res.send("Success");
};
