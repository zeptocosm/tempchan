const mysql = require("serverless-mysql")({
	config: {
		host     : process.env.ENDPOINT,
		database : process.env.DATABASE,
		user     : process.env.USERNAME,
		password : process.env.PASSWORD
	}
});

module.exports = async function(req, res) {
	const { body } = req;
	let boardCode = body.board_code;
	let textCt = body.text_ct;
	if (!textCt) {
		res.status(400).send("Missing text_ct");
		return;
	}
	let parentPostId = body.parent_post_id || 0;
	
	let now = +new Date();
	
	// Check to make sure the board exists and hasn't expired
	let boardsCountResult = await mysql.query(
		"SELECT COUNT(1) FROM boards WHERE board_code=? AND expiration_date_ms>?",
		[boardCode, now]
	);
	console.log("SELECT COUNT(1) FROM boards:", boardsCountResult);
	let boardsCount = boardsCountResult[0]["COUNT(1)"];
	if (!boardsCount) {
		res.status(400).send("Invalid board_code");
		return;
	}

	// post_id should equal 1 plus the number of already-existing rows with the same
	// board_code value.
	let insertPostResult = await mysql.query(
		`INSERT INTO posts (board_code, text_ct, parent_post_id, timestamp_ms, post_id)
		 VALUES (?,?,?,?,?)`,
		 [                  boardCode,  textCt,  parentPostId,   now,          0]);
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
