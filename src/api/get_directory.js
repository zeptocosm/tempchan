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
	let dirCode = req.query.dir_code;
	
	let dirs = await mysql.query(
		`SELECT * FROM directories
		 WHERE dir_code=?`,
		[dirCode]
	);
	console.log("SELECT * FROM directories:", dirs);

	if (!dirs.length) {
		res.status(404).send("Not found");
		return;
	}
	
	let entries = await mysql.query(
		"SELECT * FROM entries WHERE dir_code=?",
		[dirCode]
	);
	console.log("SELECT * FROM entries:", entries);

	let boardMap = {};
	for (let i=0; i<entries.length; i++) {
		let entry = entries[i];
		boardMap[entry.board_code] = entry.board_slug_ct;
	}

	let boards;
	if (entries.length) {
		boards = await mysql.query(
			"SELECT * FROM boards WHERE board_code IN (?) AND expiration_date_ms>? ORDER BY expiration_date_ms ASC",
			[Object.keys(boardMap), +new Date()]
		);
		console.log("SELECT * FROM boards:", boards);
		if (!boards) {
			// Directory has boards, but they're all expired, so it will be cleaned up soon 
			res.status(404).send("Not found");
			return;
		}
	} else {
		boards = [];
	}
	mysql.end();

	let boardsToReturn = [];
	for (let i=0; i<boards.length; i++) {
		let board = boards[i];
		delete board.writing_key_hash;
		board.moderated = !!board.owner_key_hash;
		delete board.owner_key_hash;
		board.board_slug_ct = boardMap[board.board_code];
	}

	res.send(JSON.stringify({
		boards: boards
	}));
};
