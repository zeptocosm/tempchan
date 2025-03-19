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

module.exports = async function(req, res) {
	let now = +new Date();
	let boardCode = req.query.board_code;
	let opId = req.query.op_id;
	
	let boards = await mysql.query(
		`SELECT * FROM boards
		 WHERE board_code=? AND (expiration_date_ms=0 OR expiration_date_ms>?)`,
		[boardCode, now]
	);
	if (!boards.length) {
		res.status(404).send("Not found");
		return;
	}
	let board = boards[0];

	
	let posts = await mysql.query(
		`SELECT board_code, post_id, timestamp_ms, text_ct, parent_post_id, writers_only, mod_status, author FROM posts
		 WHERE board_code=? AND (post_id=? OR parent_post_id=?)
		 ORDER BY timestamp_ms ASC`,
		[boardCode, opId, opId]
	);

	delete board.writing_key_hash;
	board.moderated = !!board.owner_key_hash;
	delete board.owner_key_hash;

	let isRolling = !!board.rolling_lifespan_ms;
	if (board.last_post_id>0 && isRolling && (board.title_ct || board.description_ct)) {
		// If post #1 is not present, the title and description have expired
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
	delete board.last_post_id;
	if (!posts.length || (isRolling && posts[0].timestamp_ms <= now-board.rolling_lifespan_ms)) {
		// if the board itself ought to have expired but still hasn't been cleaned up, show a 404.
		// (this probably won't happen, unless the cleanup job (which sets board.expiration_date_ms) fails to run for over 24 hours)
		if (isRolling && !board.expiration_date_ms) {
			// If there are any threads more recent than (2*board.rolling_lifespan_ms) ago, the board is still alive.
			// If there are none, the board is expired.
			let threadsKeepingBoardAlive = await mysql.query(
				`SELECT COUNT(1) AS c FROM posts WHERE board_code=? AND parent_post_id=0 AND timestamp_ms>?`,
				[boardCode, now-2*board.rolling_lifespan_ms]
			);
			console.log("threadsKeepingBoardAlive:", threadsKeepingBoardAlive);
			if (!threadsKeepingBoardAlive[0]["c"]) {
				res.status(404).send("Board not found");
				mysql.end()
				return;
			}
		}

		// otherwise, the board is still valid, but the thread isn't.
		res.send(JSON.stringify({
			board: board,
			posts: []
		}));
	} else if (posts.length === 1 && posts[0].parent_post_id !== 0) {
		// Trying to fetch a downthread post; redirect to parent
		res.send(JSON.stringify({
			redirect_to_parent: posts[0].parent_post_id
		}));
	} else {
		// OK
		res.send(JSON.stringify({
			board: board,
			posts: posts
		}));
	}
	mysql.end();
};
