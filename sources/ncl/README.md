# National Central Library open data

Two files from Taiwan's 政府資料開放平臺, both free under the
**政府資料開放授權條款－第 1 版** (Open Government Data License, Taiwan, v1.0).

| file | dataset | contents |
|---|---|---|
| `nbidata_115Q3.csv` | [7502](https://data.gov.tw/dataset/7502) 全國圖書書目資訊網 (NBINet) | 圖書聯合目錄, 115年第3季 — 18,519 records |
| `ncl-aleph.csv` | [27311](https://data.gov.tw/dataset/27311) 國家圖書館館藏書目資訊 | 113年度新增書目 — 118,154 records |

**Why these are committed rather than downloaded.** Every other dataset here is
fetched by `npm run import` and cached; these cannot be. Their download URLs
live on `www.ncl.edu.tw`, which answers this project with
`503 Service Temporarily Unavailable` for every path, its homepage included,
while `isbn.ncl.edu.tw` works normally. A friend in Taiwan downloaded them on
6 November 2026.

That also makes them irreplaceable in a second sense: each dataset publishes
only its current file and overwrites it, so `115年第3季` and `113年度` are gone
from the platform as soon as the next ones appear. 23 MB in git is a small
price for a build that still works in a year.

`docs/ncl-nbinet-followup.md` asks the library for the earlier quarters and for
a route that does not need a friend.

Parsed by `tools/adapters/ncl-nbinet.js` and `tools/adapters/ncl-holdings.js`.
