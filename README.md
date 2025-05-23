# Tempchan

[Tempchan](https://tempchan.com) is a tool for making throwaway discussion boards, which are:

* **Anonymous** - No account is required.
* **Private** - Each board has a secret link, and only people with the link can read or write posts. (This is enforced by end-to-end encryption.)
* **Temporary** - Everything on the board is deleted after a certain time.

Tempchan can help a group or community have more free-flowing discussions than would be possible without these three features. Create a Tempchan board and share its link to start the conversation!


## Contributing

If you like this project, I encourage you to contribute. You can help by:

* **Experimenting with Tempchan** - Create your own boards and share them with people you want to invite. Poke around with it and find bugs or come up with feature ideas. You can give feedback either [here on Github](https://github.com/zeptocosm/tempchan/issues) or on the [Tempchan Meta board](https://tempchan.com/#wWd7yXPpXDsZj3i9WLmJwi) (note that this link may be changed or removed in the future).
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

There is also a cronjob defined in `.github/workflows/cron.yaml` that pings the `/api/cleanup` endpoint regularly; this purges the database of all content that is expired and no longer visible to users. If you run your own instance, make sure that this or a similar cronjob (with the URL appropriately changed) is set up. This endpoint is secured by HTTP Basic Authentication in order to prevent third-parties from triggering it; the server must therefore set the following environment variables:

```
process.env.CLEANUP_USER
process.env.CLEANUP_PASSWORD
```

Likewise, in the Github Action configured in `cron.yaml`, we must provide the corresponding [repository variable](https://docs.github.com/actions/learn-github-actions/variables) `CLEANUP_USER` and [repository secret](https://docs.github.com/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets) `CLEANUP_PASSWORD` so that the cronjob can set the credentials in its request.

The backend uses [serverless-mysql](https://www.npmjs.com/package/serverless-mysql) to connect to MySQL. The frontend and backend both use [SJCL](https://github.com/bitwiseshiftleft/sjcl) to perform cryptographic operations.

## License

Tempchan is licensed under the GNU Affero General Public License 3.0.

Tempchan incorporates a copy of [SJCL](https://github.com/bitwiseshiftleft/sjcl) and of [QRJS2](https://github.com/englishextra/qrjs2), each of which are licensed according to their respective LICENSE.txt files.

Favicon graphics (🌸) are from [Twemoji](https://github.com/twitter/twemoji), licensed under CC-BY 4.0.
