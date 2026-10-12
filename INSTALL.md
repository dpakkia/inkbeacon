# Installing InkBeacon

InkBeacon is a Next.js app that keeps everything (books, your study, the
course list) in one **storage**, chosen with environment variables:

| Storage       | Use it for                          | Set                                                                   |
| ------------- | ----------------------------------- | --------------------------------------------------------------------- |
| A folder      | Docker, a home server, a VPS        | `STORAGE=filesystem`, `STORAGE_DIR=/path/to/data`                     |
| Vercel Blob   | Vercel                              | Connect a **private** Blob store; Vercel sets `BLOB_READ_WRITE_TOKEN` |
| S3-compatible | Netlify, or any host without a disk | `STORAGE=s3` + the `S3_*` variables below                             |

Pick a path:

- [Vercel](#vercel-one-click): one click, free tier is enough
- [Netlify](#netlify) with Cloudflare R2 (or another S3 bucket)
- [Docker / Coolify / home server](#docker-coolify-home-server)
- [Manual install](#manual-install) on a server with Node.js

Whatever you choose, you'll need a long random **access key**: it's the only
thing that protects your books and study. For example:

```bash
openssl rand -base64 36
```

## Environment variables

| Variable                                   | Required    | What it does                                                                                |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------- |
| `STUDIO_ACCESS_KEY`                        | yes         | The key you type once per device to unlock the app.                                         |
| `STORAGE`                                  | no          | `filesystem`, `vercel-blob` or `s3`. Without it, the first configured one is used.          |
| `STORAGE_DIR`                              | folder      | Where data is kept (a Docker volume: `/data`).                                              |
| `BLOB_READ_WRITE_TOKEN`                    | Vercel Blob | Set by Vercel when you connect a Blob store.                                                |
| `S3_ENDPOINT`                              | S3          | e.g. `https://<account>.r2.cloudflarestorage.com`                                           |
| `S3_BUCKET`                                | S3          | The bucket name.                                                                            |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3          | A key with read/write access to that bucket only.                                           |
| `S3_REGION`                                | no          | Default `auto` (R2). AWS: e.g. `eu-central-1`.                                              |
| `S3_VIRTUAL_HOSTED`                        | no          | `true` for AWS-style `bucket.endpoint` URLs.                                                |
| `SITE_URL`                                 | no          | Your public address (e.g. `https://books.example.com`), for link previews.                  |
| `KOREADER_PASSWORD`                        | no          | Turns on [KOReader](README.md#reading-on-koreader-optional) support; leave unset otherwise. |

## Vercel (one click)

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdpakkia%2Finkbeacon&project-name=inkbeacon&repository-name=inkbeacon&env=STUDIO_ACCESS_KEY&envDescription=A%20long%20random%20key%20that%20unlocks%20your%20library%20(e.g.%20openssl%20rand%20-base64%2036)&envLink=https%3A%2F%2Fgithub.com%2Fdpakkia%2Finkbeacon%2Fblob%2Fmain%2FINSTALL.md%23environment-variables&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D>)

The button copies the repository to your GitHub account, creates the project
and a Blob store, and asks for `STUDIO_ACCESS_KEY`.

- Check that the store is **private** (Storage tab → the store → Access). If
  it says public, create a new private store and connect it instead:
  books must never be public.
- Every push to your copy redeploys it.

## Netlify

Netlify runs Next.js 16 with no configuration, but has no disk, so use an
S3-compatible bucket. Cloudflare R2 is a good fit (no egress fees):

1. In Cloudflare, create an R2 bucket and an API token with _Object Read &
   Write_ on that bucket only. Note the account's S3 endpoint.
2. Allow uploads from your site (bucket → Settings → CORS policy):

   ```json
   [
     {
       "AllowedOrigins": ["https://your-site.netlify.app"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. In Netlify: _Add new site → Import an existing project_, pick your fork,
   keep the detected build settings, and add the variables: `STORAGE=s3`,
   `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   `STUDIO_ACCESS_KEY`, and `SITE_URL`.

Books are uploaded straight from your browser to the bucket, so Netlify's
request-size limits don't apply. The same S3 setup works on any other host.

## Docker, Coolify, home server

Data lives in a Docker volume. You need Docker with Compose.

```bash
git clone https://github.com/dpakkia/inkbeacon.git
cd inkbeacon
cp .env.example .env      # set STUDIO_ACCESS_KEY (and SITE_URL)
docker compose up -d --build
```

Open http://localhost:3000 (or the server's address on port 3000).

- **Coolify**: create a resource from your Git repository with the
  _Docker Compose_ build pack, set the variables in its UI, and give it a
  domain: Coolify adds HTTPS.
- **Home server / NAS**: the compose file above; to reach it from outside
  your network, put it behind a reverse proxy with HTTPS (see the Caddy
  example below) or a tunnel.
- **Updates**: `git pull && docker compose up -d --build`. The volume keeps
  your data.
- **Backups**: copy the volume, e.g.
  `docker run --rm -v inkbeacon_inkbeacon-data:/data -v "$PWD":/backup alpine tar czf /backup/inkbeacon-data.tgz -C /data .`

Over plain HTTP (a home network), logging in still works; over the internet,
always use HTTPS.

## Manual install

Needs Node.js 22.13 or later (24 recommended).

```bash
git clone https://github.com/dpakkia/inkbeacon.git
cd inkbeacon
npm ci
npm run build
STORAGE=filesystem STORAGE_DIR=/var/lib/inkbeacon \
STUDIO_ACCESS_KEY='…' SITE_URL='https://books.example.com' \
npm start              # port 3000; PORT=8080 npm start to change it
```

To keep it running, a systemd unit (`/etc/systemd/system/inkbeacon.service`):

```ini
[Unit]
Description=InkBeacon
After=network.target

[Service]
WorkingDirectory=/opt/inkbeacon
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=STORAGE=filesystem
Environment=STORAGE_DIR=/var/lib/inkbeacon
EnvironmentFile=/etc/inkbeacon.env
User=inkbeacon
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

with `STUDIO_ACCESS_KEY=…` in `/etc/inkbeacon.env` (readable only by root
and the `inkbeacon` user). For HTTPS, a two-line Caddyfile:

```
books.example.com {
  reverse_proxy localhost:3000
}
```

Back up `STORAGE_DIR`; that's all the data.

## After installing

1. Open the site and go to **Library**: enter the access key.
2. Add books (EPUB or a single-file HTML export). The three demo books are
   listed but have no text on a new server; load them with
   `INKBEACON_URL=https://your-site node --env-file=.env scripts/upload-book.mjs example`
   (likewise `study-notes`, `slow-reading`; their JSON is in `examples/books/`,
   copy it to `data-private/books/` first) or delete them from the Library.
3. Optional: [KOReader support](README.md#reading-on-koreader-optional).

## Moving between storages

Every backend stores the same files under the same paths (`studio/...`).
To move, copy the files as they are, e.g. with
[rclone](https://rclone.org) from a folder to a bucket, then switch the
variables.
