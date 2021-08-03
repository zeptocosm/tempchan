const mysql = require("serverless-mysql")({
	config: {
		host     : process.env.ENDPOINT,
		database : process.env.DATABASE,
		user     : process.env.USERNAME,
		password : process.env.PASSWORD
	}
});

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
		`SELECT * FROM posts
		 WHERE board_code=? AND (post_id=? OR parent_post_id=?)
		 ORDER BY timestamp_ms ASC`,
		[boardCode, opId, opId]
	);
	
	mysql.end();

	res.send(JSON.stringify({
		board: boards[0],
		posts: posts
	}));
};
