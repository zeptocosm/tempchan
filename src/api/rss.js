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

// In case String.replaceAll is not supported:
if (!String.prototype.replaceAll) {
	String.prototype.replaceAll = function(search, replace) {
		return this.replace(new RegExp(search, "g"), replace);
	}
}

const FEED_SIZE = 15;

const FEED_TEMPLATE = 
`<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>

<title>Tempchan: {{boardCode}}</title>
<description>Encrypted feed for Tempchan board "{{boardCode}}". To see the real content, visit the board in your web browser.</description>
<link>https://{{siteUrl}}/#{{boardCode}}</link>
<lastBuildDate>{{updatedDate}}</lastBuildDate>
<pubDate>{{updatedDate}}</pubDate>

{{feedItems}}</channel>
</rss>`;

const FEED_ITEM_TEMPLATE =
`<item>
<title>{{itemTitle}}</title>
<description>{{itemDescription}}</description>
<link>https://{{siteUrl}}/#{{boardCode}}/t/{{itemLink}}</link>
<guid>https://{{siteUrl}}/#{{boardCode}}/t/{{itemLink}}</guid>
<pubDate>{{itemDate}}</pubDate>
</item>`;

const TITLE_TRUNCATION = 15;
const PRETTIFIED_GROUP_SIZE = 5;

const prettify = function(ct, truncation) {
	let ctValue;
	try {
		let ctObj = JSON.parse(ct);
		ctValue = ctObj.ct;
	} catch {
		ctValue = "";
	}

	let output = "";
	let outputLength = ctValue ?
		ctValue.length :
		Math.max(ct.length - 63, PRETTIFIED_GROUP_SIZE);
	let ellipsis = "";
	if (truncation && truncation<outputLength) {
		ellipsis = "...";
	}
	if (!truncation) {
		truncation = outputLength;
	}
	for (let i=0; i<outputLength && i<truncation; i++) {
		if (i % PRETTIFIED_GROUP_SIZE === 0) {
			output += " ";
		}
		output += (ctValue ? ctValue.charAt(i) : "X");
	}
	output = output.trim();
	output += ellipsis;
	return output;
};

const formatDate = function(dateMs) {
	return new Date(dateMs).toGMTString();
};

module.exports = async function(req, res) {
	let boardCode = req.query.board;
	if (!boardCode) {
		res.status(400).send("Missing board");
		return;
	}
	let now = +new Date();
	let boards = await mysql.query(
		"SELECT * FROM boards WHERE board_code=? AND expiration_date_ms>?",
		[boardCode, now]
	);
	if (!boards.length) {
		res.status(404).send("Board not found");
		mysql.end()
		return;
	}

	let recentPosts = await mysql.query(
		`SELECT post_id, timestamp_ms, text_ct, parent_post_id FROM posts
		 WHERE board_code=? AND post_id>0
		 ORDER BY timestamp_ms DESC LIMIT ?`,
		[boardCode, FEED_SIZE]
	);

	// First pass: See which parents are mentioned
	let parentsToFetch = {};
	for (let i=0; i<recentPosts.length; i++) {
		let post = recentPosts[i];
		if (post.parent_post_id) {
			parentsToFetch[post.parent_post_id] = true;
		}
	}

	// Second pass: See which parents have already been fetched
	let parentPosts = {};
	for (let i=0; i<recentPosts.length; i++) {
		let post = recentPosts[i];
		let postId = post.post_id;
		if (parentsToFetch[postId]) {
			parentPosts[postId] = post;
			delete parentsToFetch[postId];
		}
	}

	// If any parents have not yet been fetched, fetch them
	let parentsToFetchList = Object.keys(parentsToFetch);
	if (parentsToFetchList.length) {
		let additionalParents = await mysql.query(
			`SELECT post_id, timestamp_ms, text_ct FROM posts
			 WHERE board_code=? AND post_id IN (` +
			 	parentsToFetchList.join(",") +
			 `)`,
			[boardCode]
		);
		for (let i=0; i<additionalParents.length; i++) {
			let parent = additionalParents[i];
			parentPosts[parent.post_id] = parent;
		}
	}
	mysql.end();


	let siteUrl = req.headers.host;

	let feedItemsXml = "";
	for (let i=0; i<recentPosts.length; i++) {
		let post = recentPosts[i];

		let itemTitle;
		let itemDescription;
		let itemLink;
		if (post.parent_post_id) {
			let parentPostId = post.parent_post_id;
			let parent = parentPosts[parentPostId];
			itemTitle = "Re: " + prettify(parent.text_ct, TITLE_TRUNCATION);
			itemDescription = prettify(post.text_ct);
			itemLink = parentPostId + "#" + post.post_id;
		} else {
			itemTitle = prettify(post.text_ct, TITLE_TRUNCATION);
			itemDescription = prettify(post.text_ct);
			itemLink = post.post_id;
		}
		let itemDate = formatDate(post.timestamp_ms);

		let feedItemXml = FEED_ITEM_TEMPLATE
			.replaceAll("{{itemTitle}}", itemTitle)
			.replaceAll("{{itemDescription}}", itemDescription)
			.replaceAll("{{siteUrl}}", siteUrl)
			.replaceAll("{{boardCode}}", boardCode)
			.replaceAll("{{itemLink}}", itemLink)
			.replaceAll("{{itemDate}}", itemDate);
		feedItemsXml += feedItemXml + "\n\n";
	}

	let updatedDate = formatDate(recentPosts.length ? recentPosts[0].timestamp_ms : now);
	let feedXml = FEED_TEMPLATE
		.replaceAll("{{boardCode}}", boardCode)
		.replaceAll("{{siteUrl}}", siteUrl)
		.replaceAll("{{updatedDate}}", updatedDate)
		.replaceAll("{{feedItems}}", feedItemsXml);

	res.setHeader("Content-Type", "text/xml");
	res.send(feedXml);
};
