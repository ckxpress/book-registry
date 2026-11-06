# Follow-up to the NCL: NBINet, and why the ask is small

A short addendum to [`ncl-data-request.md`](ncl-data-request.md), which has
already been sent. Send it as a reply on that thread rather than as a new
message.

**Why it is worth sending.** The first letter asked for the pre-2024 monthly
files of 臺灣出版新書預告書訊 — a pre-publication announcement feed, which is
useful but thin. NBINet, the union catalogue, is the far better source: real
MARC21 catalogue records with titles in Chinese characters, from eighty-odd
member libraries, reaching back decades.

**And the ask is unusually small.** NBINet's union catalogue now runs on Ex
Libris Alma, discovered through Primo
(`nbinet.primo.exlibrisgroup.com/nde/home?vid=886NCL_NBINET:NBINET`). Alma has
OAI-PMH and scheduled publishing built in, so what we are asking for is a
configuration they already own rather than a project someone has to build. The
letter says so, because an ask that names the mechanism is much easier to say
yes to than one that does not.

**It also says, plainly, that we read their `robots.txt` and stopped.** The
only machine-readable path into the new system is `/primaws`, and
`robots.txt` disallows it. We are not going to take it anyway, and saying so
is both honest and the strongest argument that the data would be handled
responsibly.

Not sent by Claude. Check it reads the way you want, add your name, send it
yourself.

---

## Draft (Traditional Chinese)

**主旨：Re: 詢問「臺灣出版新書預告書訊」2024 年 1 月以前的歷史月檔 — 補充一事（NBINet）**

陳小姐 您好：

接續前一封信，想再補充一個或許更合適的方向，叨擾之處還請見諒。

前信詢問的是「臺灣出版新書預告書訊」。不過該資料集本質上是出版前的 ISBN 申請預告，
書名與著者等欄位較為簡略。若以建立可長期保存、可檢索的書目目錄為目的，
**全國圖書書目資訊網（NBINet）聯合目錄**顯然是更完整的來源：它是正式的 MARC21
編目紀錄，書名為中文字（而非拼音轉寫），且涵蓋年代遠早於 2024 年。

我注意到 NBINet 聯合目錄已改以 Ex Libris 的 Alma／Primo 系統提供服務。
因此想請教的是：

1. 是否可能為 NBINet 開放 **OAI-PMH** 端點（Alma 內建此功能），供外部以標準協定
   定期收割書目紀錄？若需限定範圍，僅提供臺灣出版品（出版地為臺灣）的子集即可。
2. 或者，是否可透過 Alma 的 **publishing profile**，定期輸出 MARC21／MARCXML
   批次檔（例如每月一次置於 FTP 或物件儲存空間）供下載？
3. 若上述皆不可行，是否有其他合乎貴館規範的批次取得方式？或可否告知應向哪個單位
   （例如書目資訊中心或 NBINet 決策委員會）提出申請？

需要特別說明的是：NBINet 新系統的機器可讀介面路徑（`/primaws`）在
`robots.txt` 中明確標示為 Disallow，因此本專案**並未、也不會**以程式自該介面
擷取資料。這封信正是因為那條規則而寫的 —— 與其繞過，不如直接請教。

本專案「神保町」（jimbocho.app）為非商業性質，目前收錄香港與臺灣書目共約 31 萬筆。
若蒙提供，會依貴館指定的授權條款使用，於頁面明確標示資料來源為國家圖書館／NBINet
及原編目館，並樂意配合任何引用格式或使用範圍的要求。

若此事不屬 貴中心業務範圍，煩請指點應洽詢的單位，感謝您。

順祝 工作順心

（您的姓名）
（您的電子郵件 / 聯絡方式）
jimbocho.app

---

## Draft (English)

**Subject: Re: Access to pre-2024 monthly files of 臺灣出版新書預告書訊 —
one addition (NBINet)**

Dear Ms Chen,

Following on from my earlier message, may I add one suggestion that may suit
better than the original request.

I asked about 臺灣出版新書預告書訊. That dataset is, by its nature, a record of
pre-publication ISBN applications, so its title and author fields are fairly
sparse. For building a durable, searchable catalogue, the **NBINet union
catalogue** is plainly the better source: full MARC21 records, titles in
Chinese characters rather than romanisation, and coverage going back far
earlier than 2024.

I notice NBINet's union catalogue is now served through Ex Libris Alma and
Primo. So my question is:

1. Would it be possible to expose an **OAI-PMH** endpoint for NBINet? Alma
   provides this natively, and it would let the records be harvested by a
   standard protocol. A subset — Taiwanese imprints only — would be entirely
   sufficient if a full set is too broad.
2. Alternatively, could an Alma **publishing profile** export MARC21 or
   MARCXML in batches on a schedule, say monthly to an FTP or object store?
3. If neither is possible, is there another route that fits the library's
   policies — or another office (the bibliographic centre, or the NBINet
   steering committee) I should be writing to instead?

One thing I should state plainly: the machine-readable path of the new NBINet
system (`/primaws`) is marked `Disallow` in its `robots.txt`, and this project
has not harvested it and will not. This letter exists precisely because of that
rule — asking seemed better than working around it.

神保町 (jimbocho.app) is non-commercial and currently holds about 310,000 Hong
Kong and Taiwan records. Anything provided would be used under whatever licence
the library specifies, with the National Central Library, NBINet and the
cataloguing library credited on the page, and I am happy to meet any
requirements on citation or scope.

If this falls outside your centre's remit, I would be grateful for a pointer to
the right office.

With thanks,

(your name)
(your email / contact)
jimbocho.app
