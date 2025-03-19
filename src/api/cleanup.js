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

const equals = function(standard, provided) {
	var result = true;
	for (let i=0; i<provided.length; i++) {
		let c1 = provided[i];
		if (i < standard.length) {
			let c2 = standard[i];
			if (c1 !== c2) {
				result = false;
			}
		} else {
			result = false;
		}
	}
	return result;
}

const checkAuthentication = function(authHeader) {
	let authentication = authHeader.replace(/^Basic/, "");
	authentication = Buffer.from(authentication, "base64").toString("utf8");
	const loginInfo = authentication.split(":");
	var corrects = 0;
	if (loginInfo[0] && equals(process.env.CLEANUP_USER, loginInfo[0])) {
		corrects++;
	}
	if (loginInfo[1] && equals(process.env.CLEANUP_PASSWORD, loginInfo[1])) {
	    corrects++;
	}
	return corrects === 2;
}

module.exports = async function(req, res) {
	if (!req.headers.authorization) {
	  res.status(401).send("Not authorized");
	  return;
	}

	if (!checkAuthentication(req.headers.authorization)) {
	  res.status(403).send("Forbidden");
	  return;
	}

	let now = +new Date();

	// delete expired threads from rolling boards.
	let rollingBoards = await mysql.query("SELECT board_code, rolling_lifespan_ms FROM boards WHERE rolling_lifespan_ms>0");
	for (let i=0; i<rollingBoards.length; i++) {
		let board = rollingBoards[i];
		let threads = await mysql.query("SELECT board_code, post_id, parent_post_id, timestamp_ms FROM posts WHERE board_code=? AND parent_post_id=0", [board.board_code]);
		let expiredThreads = threads.filter( thread => thread.timestamp_ms <= now-board.rolling_lifespan_ms );
		if (threads.length > 0) {
			let boardExpirationMs;
			if (threads.length === expiredThreads.length) {
				// the board is about to become empty, so set its expiration_date_ms.
				boardExpirationMs = Math.max.apply(Math, threads.map(thread => thread.timestamp_ms)) + 2*board.rolling_lifespan_ms;
			} else {
				boardExpirationMs = 0;
			}

			// if we're deleting thread #1, expire the title and description
			let expireTitleAndDescription = !!((expiredThreads.filter(thread => thread.post_id === 1)).length);
			
			let expirationResult;
			if (boardExpirationMs && expireTitleAndDescription) {
				expirationResult = await mysql.query(
					`UPDATE boards SET expiration_date_ms=?, title_ct="", description_ct="" WHERE board_code=?`,
					[boardExpirationMs, board.board_code]
				);
			} else if (boardExpirationMs) {
				expirationResult = await mysql.query(
					`UPDATE boards SET expiration_date_ms=? WHERE board_code=?`,
					[boardExpirationMs, board.board_code]
				);
			} else if (expireTitleAndDescription) {
				expirationResult = await mysql.query(
					`UPDATE boards SET title_ct="", description_ct="" WHERE board_code=?`,
					[board.board_code]
				);
			} else {
				// nothing to do
				expirationResult = null;
			}
			console.log("expirationResult:", expirationResult);
		}
		if (expiredThreads.length) {
			let expiredOpIds = expiredThreads.map(thread => thread.post_id).join(",");
			let deleteThreadsResult = await mysql.query(
				"DELETE FROM posts WHERE board_code=? AND (post_id IN (" +expiredOpIds + ") OR parent_post_id IN ("+expiredOpIds+"))", [board.board_code],
			);
			console.log("delete threads:", deleteThreadsResult);
		}
	}

	// delete expired boards
	let boardsToCleanUp = await mysql.query(
		"SELECT board_code FROM boards WHERE expiration_date_ms>0 AND expiration_date_ms<=?",
		[now]
	);
	console.log("SELECT board_code FROM boards:", boardsToCleanUp);
	if (boardsToCleanUp.length) {
		let expiredBoardCodes = "";
		for (let i=0; i<boardsToCleanUp.length; i++) {
			let boardCode = boardsToCleanUp[i].board_code;
			expiredBoardCodes += ('"' + boardCode + '"');
			if (i < boardsToCleanUp.length-1) {
				expiredBoardCodes += ",";
			}
		}
		console.log("expiredBoardCodes:", expiredBoardCodes);

		let deletePostsResult = await mysql.query(
			"DELETE FROM posts WHERE board_code IN (" +expiredBoardCodes + ")",
		);
		console.log("DELETE FROM posts:", deletePostsResult);

		let deleteBoardsResult = await mysql.query(
			"DELETE FROM boards WHERE board_code IN (" +expiredBoardCodes + ")",
			[expiredBoardCodes]
		);
		console.log("DELETE FROM boards:", deleteBoardsResult);

		let deleteEntriesResult = await mysql.query(
			"DELETE FROM entries WHERE board_code IN (" +expiredBoardCodes + ")",
		);
		console.log("DELETE FROM entries:", deleteEntriesResult);
	}

	// delete empty directories
	let deleteDirsResult = await mysql.query(
		`DELETE FROM directories AS dir
		WHERE 0=(SELECT COUNT(1) FROM entries AS entry WHERE dir.dir_code = entry.dir_code)`
	);
	console.log("DELETE FROM directories:", deleteDirsResult);

	mysql.end();
	res.send("Success");
};
