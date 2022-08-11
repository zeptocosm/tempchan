CREATE TABLE IF NOT EXISTS boards (
	board_code VARCHAR(10) NOT NULL PRIMARY KEY,
	expiration_date_ms BIGINT NOT NULL,
	title_ct VARCHAR(1000),
	description_ct TEXT,
	writing_key_hash VARCHAR(100) NOT NULL,
	owner_key_hash VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS posts (
	incrementing_id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
	board_code VARCHAR(10) NOT NULL,
	post_id INT NOT NULL,
	timestamp_ms BIGINT NOT NULL,
	text_ct TEXT,
	parent_post_id INT,
	writers_only BOOLEAN,
	mod_status INT, -- 0=Default, 1=Hidden
	author INT -- 0=Anonymous, 1=Moderator
);
