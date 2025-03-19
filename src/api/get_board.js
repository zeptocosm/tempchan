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

const PAGE_SIZE = 10;

module.exports = async function(req, res) {
	let now = +new Date();
	let boardCode = req.query.board_code;
	let boards = await mysql.query(
		"SELECT * FROM boards WHERE board_code=? AND (expiration_date_ms=0 OR expiration_date_ms>?)",
		[boardCode, now]
	);
	if (!boards.length) {
		res.status(404).send("Board not found");
		mysql.end()
		return;
	}
	let board = boards[0];
	let isRolling = !!board.rolling_lifespan_ms;

	// Find the number of threads, so we know how many pages there are.
	let threadCount = await mysql.query(
		`SELECT COUNT(1) AS c FROM posts
		WHERE board_code=? AND parent_post_id=0` + (isRolling ? " AND timestamp_ms>?" : ""),
		isRolling ? [boardCode, now-board.rolling_lifespan_ms] : [boardCode]
	);
	console.log("Thread count:", threadCount);
	let pageCount = Math.ceil(threadCount[0]["c"] / PAGE_SIZE);
	if (pageCount === 0) {
		pageCount = 1;
	}
	let pageNum = req.query.page || 1;

	if (pageNum > pageCount) {
		res.status(404).send("Page does not exist");
		mysql.end()
		return;
	}

	// Sort the threads in descending chronological bump order
	// (i.e. according to the timestamp of the last reply).
	let offset = (pageNum-1) * PAGE_SIZE;
	let postsOnBoard = await mysql.query(
		`SELECT
			op.board_code, op.post_id, op.timestamp_ms, op.text_ct, op.parent_post_id, op.writers_only, op.mod_status, op.author,
			(
				SELECT MAX(timestamp_ms) FROM posts AS reply
				WHERE reply.board_code=? AND (
					reply.parent_post_id = op.post_id OR
					reply.post_id = op.post_id
				)
			) AS bump_timestamp_ms,
			(
				SELECT COUNT(1) FROM posts AS reply
				WHERE reply.board_code=? AND
					reply.parent_post_id = op.post_id
			) AS replies_count
			FROM posts AS op
		 WHERE op.board_code=? AND op.parent_post_id=0`+(isRolling ? " AND op.timestamp_ms>?" : "")+
		 ` ORDER BY bump_timestamp_ms DESC LIMIT ? OFFSET ?`,
		isRolling ? [boardCode, boardCode, boardCode, now-board.rolling_lifespan_ms, PAGE_SIZE, offset]
			: [boardCode, boardCode, boardCode, PAGE_SIZE, offset]
	);
	
	let threads = [];
	for (let i=0; i<postsOnBoard.length; i++) {
		let op = postsOnBoard[i];
		let replies = await mysql.query(
			`SELECT board_code, post_id, timestamp_ms, text_ct, parent_post_id, writers_only, mod_status, author FROM posts
			 WHERE board_code=? AND parent_post_id=?
			 ORDER BY timestamp_ms DESC LIMIT 2`,
			[boardCode, op.post_id]
		);
		threads.push({
			op: op,
			last_replies: replies
		});
	}

	if (board.last_post_id>0 && isRolling && (board.title_ct || board.description_ct)) {
		// If post #1 is absent/expired, the title and description have expired
		let firstPostLookup = await mysql.query(
			`SELECT COUNT(1) AS c FROM posts WHERE board_code=? AND post_id=1 AND timestamp_ms>?`,
			[boardCode, now-board.rolling_lifespan_ms]
		);
		console.log("firstPostLookup:", firstPostLookup);
		if (!firstPostLookup[0]["c"]) {
			delete board.title_ct;
			delete board.description_ct;
		}
	}

	// Also, it's possible that the board has become empty but hasn't been cleaned up yet.
	// If so, pretend as if expiration_date_ms has already been set.
	if (!postsOnBoard.length && !board.expiration_date_ms) {
		let lastThreadLookup = await mysql.query(
			`SELECT timestamp_ms FROM posts WHERE board_code=? AND parent_post_id=0 ORDER BY timestamp_ms DESC LIMIT 1`,
			[boardCode]
		);
		// This should return 1 result, because when the cleanup job deletes the expired threads, it also sets expiration_date_ms.
		console.log("lastThreadLookup:", lastThreadLookup);
		if (lastThreadLookup.length === 1) {
			let calculatedExpirationTimeMs = lastThreadLookup[0].timestamp_ms + 2*board.rolling_lifespan_ms;
			if (calculatedExpirationTimeMs <= now) {
				res.status(404).send("Board not found");
				mysql.end()
				return;
			} else {
				board.expiration_date_ms = calculatedExpirationTimeMs;
			}
		}
	}

	mysql.end();

	delete board.writing_key_hash;
	board.moderated = !!board.owner_key_hash;
	delete board.owner_key_hash;
	delete board.last_post_id;

	let result = {
		board: board,
		threads: threads,
		page_count: pageCount
	};

	res.send(JSON.stringify(result));
};
