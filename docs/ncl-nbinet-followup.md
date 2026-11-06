# Follow-up to the NCL: the open-data files we cannot reach

A short addendum to [`ncl-data-request.md`](ncl-data-request.md), which has
already been sent. Send it as a reply on that thread.

**What changed.** The National Central Library already publishes, on
data.gov.tw, free and openly-licensed bulk files that are far better than the
pre-publication feed the first letter asked about:

| id | dataset | licence |
|---|---|---|
| **7502** | 全國圖書書目資訊網(NBINet) — the union catalogue | OGDL v1.0, 免費 |
| **27311** | 國家圖書館館藏書目資訊 — the library's own holdings | OGDL v1.0, 免費 |
| 37878 | 臺灣華文電子書庫書目資料 | OGDL v1.0, 免費 |
| 7503 | 漢學出版品書目資料 | OGDL v1.0, 免費 |

NBINet is the one that matters: "國家圖書館及各類型合作單位陸續提供之書目及館藏
資料、國際標準書號中心新書書目、漢學研究中心藏書目錄" — real catalogue records
from eighty-odd libraries, with titles in Chinese characters rather than
romanisation, reaching back decades.

**The obstacle is no longer permission; it is that the files will not
download.** All four live on `www.ncl.edu.tw`, which returns
`503 Service Temporarily Unavailable` to us — the whole host, not just those
paths. `isbn.ncl.edu.tw` works normally, so it is specific to that server.

So this letter is narrow: the data is already open, and we are asking whether
the download URLs still work and, if not, how else to get the files. That is a
much easier thing to answer than a request for new infrastructure.

**On NBINet's other interface.** The union catalogue's own search system is now
Ex Libris Primo, whose only machine-readable path (`/primaws`) is marked
`Disallow` in `robots.txt`. This project has not harvested it and will not, and
the letter says so — because it is true, and because it is the clearest
evidence that the data would be handled the way they would want.

Not sent by Claude. Check it reads the way you want, add your name, send it.

---

## Draft (Traditional Chinese)

**主旨：Re: 詢問「臺灣出版新書預告書訊」2024 年 1 月以前的歷史月檔 — 補充（NBINet 開放資料檔無法下載）**

陳小姐 您好：

接續前一封信，有一項補充，或許比原先的詢問更容易處理。

我後來在政府資料開放平臺上查到，貴館其實已經發布了數個以「政府資料開放授權條款－
第 1 版」免費開放的書目資料集，其中幾項對本專案特別重要：

- 資料集 **7502**「全國圖書書目資訊網（NBINet）」
- 資料集 **27311**「國家圖書館館藏書目資訊」
- 資料集 **37878**「臺灣華文電子書庫書目資料」
- 資料集 **7503**「漢學出版品書目資料」

問題在於：上述資料集的下載網址都位於 `www.ncl.edu.tw`，而該主機目前對本端連線
一律回應 `503 Service Temporarily Unavailable`（並非僅限上述路徑，首頁亦同）。
相對地，`isbn.ncl.edu.tw` 一切正常，因此應屬該台伺服器的個別狀況。

想請教：

1. 這幾個資料集的下載連結目前是否仍然有效？是否曾更換網址？
2. 若 `www.ncl.edu.tw` 的檔案服務暫時不穩定，是否有其他取得方式
   （例如另一主機、FTP、或由貴館直接提供一份）？
3. 7502（NBINet）的檔案大致為多大、涵蓋多少筆書目、更新頻率為何？
   資料集頁面標示為「不定期更新」，想了解實際情形以便安排同步。

另想說明一事：NBINet 聯合目錄的新系統（Ex Libris Primo）其機器可讀介面路徑
`/primaws` 在 `robots.txt` 中標示為 Disallow，因此本專案**並未、也不會**以程式
自該介面擷取資料。我們希望循貴館正式發布的開放資料管道取用，這也是寫這封信的原因。

本專案「神保町」（jimbocho.app）為非商業性質，目前收錄香港與臺灣書目約 31 萬筆，
會依「政府資料開放授權條款－第 1 版」使用，並於頁面明確標示資料來源為國家圖書館
／NBINet 及原編目館。

若此事不屬 貴中心業務範圍，煩請指點應洽詢的單位，感謝您撥冗。

順祝 工作順心

（您的姓名）
（您的電子郵件 / 聯絡方式）
jimbocho.app

---

## Draft (English)

**Subject: Re: Access to pre-2024 monthly files of 臺灣出版新書預告書訊 —
NBINet open data will not download**

Dear Ms Chen,

Following on from my earlier message, with something that may be easier to
resolve than the original request.

I have since found that the library already publishes several bibliographic
datasets on data.gov.tw, free and under the Open Government Data License v1.0.
Four matter a great deal to this project:

- **7502** 全國圖書書目資訊網 (NBINet)
- **27311** 國家圖書館館藏書目資訊
- **37878** 臺灣華文電子書庫書目資料
- **7503** 漢學出版品書目資料

The difficulty is that every one of those download URLs sits on
`www.ncl.edu.tw`, and that host currently returns
`503 Service Temporarily Unavailable` to us — the whole server, its homepage
included, not only those paths. `isbn.ncl.edu.tw` works normally, so this looks
specific to that machine.

Could you tell me:

1. Whether those download links are still current, or whether the URLs have
   changed?
2. If the file service on `www.ncl.edu.tw` is unreliable at present, whether
   there is another way to obtain them — a different host, FTP, or a copy sent
   directly?
3. Roughly how large the NBINet file (7502) is, how many records it holds, and
   how often it is refreshed? The dataset page says "不定期更新", and knowing the
   real cadence would help me schedule synchronisation politely.

One thing I should state plainly: the NBINet union catalogue's new discovery
system (Ex Libris Primo) marks its machine-readable path `/primaws` as
`Disallow` in `robots.txt`, and this project has not harvested it and will not.
We would much rather take the data through the open-data channel the library
publishes deliberately — which is why I am writing.

神保町 (jimbocho.app) is non-commercial and currently holds about 310,000 Hong
Kong and Taiwan records. Anything obtained would be used under the Open
Government Data License v1.0, with the National Central Library, NBINet and the
contributing library credited on the page.

If this falls outside your centre's remit, I would be grateful for a pointer to
the right office.

With thanks,

(your name)
(your email / contact)
jimbocho.app
