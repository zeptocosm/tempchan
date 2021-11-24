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

const PAGE_SIZE = 10;

module.exports = async function(req, res) {
	let boardCode = req.query.board_code;
	let boards = await mysql.query(
		"SELECT * FROM boards WHERE board_code=? AND expiration_date_ms>?",
		[boardCode, +new Date()]
	);
	if (!boards.length) {
		res.status(404).send("Board not found");
		mysql.end()
		return;
	}
	
	// Find the number of threads, so we know how many pages there are.
	let threadCount = await mysql.query(
		`SELECT COUNT(1) FROM posts
		WHERE board_code=? AND parent_post_id=0`,
		[boardCode]
	);
	console.log("Thread count:", threadCount);
	let pageCount = Math.ceil(threadCount[0]["COUNT(1)"] / PAGE_SIZE);
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
			op.board_code, op.post_id, op.timestamp_ms, op.text_ct, op.parent_post_id,
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
		 WHERE op.board_code=? AND op.parent_post_id=0
		 ORDER BY bump_timestamp_ms DESC LIMIT ? OFFSET ?`,
		[boardCode, boardCode, boardCode, PAGE_SIZE, offset]
	);
	
	let threads = [];
	for (let i=0; i<postsOnBoard.length; i++) {
		let op = postsOnBoard[i];
		let replies = await mysql.query(
			`SELECT board_code, post_id, timestamp_ms, text_ct, parent_post_id FROM posts
			 WHERE board_code=? AND parent_post_id=?
			 ORDER BY timestamp_ms DESC LIMIT 2`,
			[boardCode, op.post_id]
		);
		threads.push({
			op: op,
			last_replies: replies
		});
	}
	mysql.end();

	let result = {
		board: boards[0],
		threads: threads,
		page_count: pageCount
	};

	res.send(JSON.stringify(result));
};
