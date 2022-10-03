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
	let boardsToCleanUp = await mysql.query(
		"SELECT board_code FROM boards WHERE expiration_date_ms<=?",
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

	let deleteDirsResult = await mysql.query(
		`DELETE FROM directories AS dir
		WHERE 0=(SELECT COUNT(1) FROM entries AS entry WHERE dir.dir_code = entry.dir_code)`
	);
	console.log("DELETE FROM directories:", deleteDirsResult);

	mysql.end();
	res.send("Success");
};
