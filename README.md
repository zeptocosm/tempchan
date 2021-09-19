# Tempchan

[Tempchan](https://tempchan.com) is a tool for making throwaway discussion boards, which are:

* **Anonymous** - No account is required.
* **Private** - Each board has a secret link, and only people with the link can read or write posts. (This is enforced by end-to-end encryption.)
* **Temporary** - The board is deleted after a certain time.

Tempchan can help a group or community have more free-flowing discussions than would be possible without these three features. Create a Tempchan board and share its link to start the conversation!


## Contributing

If you like this project, I encourage you to contribute. You can help by:

* **Experimenting with Tempchan** - Create your own boards and share them with people you want to invite. Poke around with it and find bugs or come up with feature ideas. You can give feedback either [here on Github](https://github.com/zeptocosm/tempchan/issues) or on the [Tempchan Meta board](http://tempchan.com/#Qm7kWF6cvCKwuckvcaSsKTzHq) (note that this link may be changed or removed in the future).
* **Deploying your own instance** - The more Tempchan instances there are, the more options people will have to create their own boards, without having to rely on any one instance. I would also like to make the code as platform-independent as possible.
* **Opening pull requests** - The issue tracker lists features that I'd like to add eventually but don't have time to work on right now, so if you want to write your own implementation I'd be glad to merge it in.


## Technical

Tempchan is written as a single-page application (HTML+CSS+JS) supported by a serverless NodeJS backend that connects to a MySQL database. The main page (`src/index.html`) and the assets under `src/static/` are served statically; each `.js` file under `src/api/` supports one API endpoint. For example, an HTTP request to `/api/create_post` is handled by `create_post.js`.

It's probably not hard to deploy this code as a traditional (non-serverless) backend, by adding a module that routes requests to the various `.js` handlers. If you can get this working, I'd welcome a pull request to add this capability.

In order to connect to the MySQL database, the following environment variables must be set:

```
process.env.ENDPOINT
process.env.DATABASE
process.env.USERNAME
process.env.PASSWORD
```

You must also set `process.env.CA_PATH` if the path to the certificate authority on your system differs from the default provided. If the default doesn't work, see [here](https://docs.planetscale.com/reference/secure-connections#ca-root-configuration) for a list of possibilities to try.

The database must be initialized as described in `schema.sql`.

There is also a cronjob defined in `.github/workflows/cron.yaml` that pings the `/api/cleanup` endpoint daily. If you run your own instance, make sure that this or a similar cronjob (with the URL appropriately changed) is set up.

The backend uses [serverless-mysql](https://www.npmjs.com/package/serverless-mysql) to connect to MySQL. The frontend uses [SJCL](https://github.com/bitwiseshiftleft/sjcl) to perform cryptographic operations, but SJCL is not used on the backend.

## License

I haven't decided which open-source license to use yet, but I intend to add one soon. Until then, the following terms apply:

* Anyone who wants to run this code (modified or not) may do so.
* If you contribute code you agree that it may be used in the same way, and that it will be covered by whatever license I end up choosing.

This software incorporates a copy of SJCL, which is licensed according to its LICENSE.txt file.
