# Asking the NCL for the archived bibliographic files

Two letters, to two people, about two datasets. Both are follow-ups to
[`ncl-data-request.md`](ncl-data-request.md), which went to the ISBN centre
about a third dataset.

**What we have.** A friend in Taiwan downloaded the two current files for us,
because `www.ncl.edu.tw` answers this address with 503 and the whole host is
unreachable from here:

| file | records | Taiwan imprints | Chinese-character titles |
|---|---|---|---|
| `nbidata_115Q3.csv` (7502, NBINet 115年第3季) | 18,519 | 96% | **99.1%** |
| `ncl-aleph.csv` (27311, 113年度新增書目) | 118,154 | 45% | 72.3% |

Both are free under the Open Government Data License v1.0. The NBINet file is
the best-quality Taiwanese bibliographic data this project has seen — against
4% Chinese-character titles in the Open Library set, 99.1% here.

**What we are asking for, and why it is a small ask.** Each dataset publishes
only its current file and overwrites it: 7502 offers 115年第3季 and nothing
earlier, 27311 offers 113年度 alone. 7502 has been listed since 2013 and 27311
since 2016, so roughly fifty quarterly files and nine annual ones have been
published and replaced. Those files existed; they are simply no longer served.
Asking for the archive is asking for copies of things already published under
an open licence, not for anything new to be made.

**Contacts, from each dataset's own page.** All on 02-23619132:

- **鄭小姐** ext 189 — dataset 7502, NBINet
- **向先生** ext 631 — dataset 27311, 館藏書目資訊
- 陳小姐 ext 728 — dataset 6730, ISBN centre (already written to)

Send each letter to the person for that dataset.

**On NBINet's other interface.** The union catalogue's search system is now Ex
Libris Primo, whose only machine-readable path (`/primaws`) is `Disallow` in
`robots.txt`. This project has not harvested it and will not, and both letters
say so — it is true, and it is the clearest evidence the data would be handled
the way they would want.

Not sent by Claude. Check they read the way you want, add your name, send them.

---

## Draft (Traditional Chinese)

### 給 鄭小姐（資料集 7502，NBINet）

**主旨：詢問「全國圖書書目資訊網(NBINet)」歷季書目檔案**

鄭小姐 您好：

我是一個非商業的開放資料小專案「神保町」（jimbocho.app）的維護者，網站把香港與
臺灣的書刊書目整理成可瀏覽、可檢索的目錄，目前約收錄 31 萬筆。

近日取得了貴館發布於政府資料開放平臺的資料集 7502「全國圖書書目資訊網（NBINet）」
最新一季檔案（NBINet圖書聯合目錄 115 年第 3 季，nbidata_115Q3.csv，18,519 筆）。
資料品質非常好 —— 其中 96% 為臺灣出版品，99% 的題名為中文字（而非拼音轉寫），
這對中文檢索而言至關重要。非常感謝貴館持續發布這份資料。

想請教的是歷季檔案：該資料集頁面每次僅提供最新一季，前一季的檔案即不再保留連結。
依上架日期（2013 年 12 月）推算，過去約已發布五十餘季。

1. 歷季的 NBINet 書目檔（例如 103 年第 1 季至 115 年第 2 季）是否仍有保存？
   可否提供批次下載，或以其他方式提供一份？
2. 若逐季檔案不便提供，是否有涵蓋全部書目的單一彙整檔？
3. 這份季檔的收錄範圍為何？是「該季新增編目紀錄」，或是某種其他的擷取方式？
   了解這點有助於我們正確標示資料性質，避免誤導讀者。

另需說明一事：本專案自海外連線時，`www.ncl.edu.tw` 一律回應
`503 Service Temporarily Unavailable`（首頁亦同；`isbn.ncl.edu.tw` 則正常），
因此上述檔案是請臺灣的友人代為下載。若貴館知悉該情形或有其他下載管道，也煩請告知。

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

### To 鄭小姐 (dataset 7502, NBINet)

**Subject: Archived quarterly files of 全國圖書書目資訊網 (NBINet)**

Dear Ms Cheng,

I maintain a small non-commercial open-data project, 神保町 (jimbocho.app),
which turns Hong Kong and Taiwan book metadata into a browsable, searchable
catalogue — about 310,000 records at present.

I have recently obtained the current file from your dataset 7502, 全國圖書書目
資訊網 (NBINet): NBINet圖書聯合目錄 115年第3季, `nbidata_115Q3.csv`, 18,519
records. The quality is excellent — 96% Taiwanese imprints, and 99% of titles
in Chinese characters rather than romanisation, which matters enormously for
searching in Chinese. Thank you for publishing it.

My question is about the earlier quarters. The dataset page offers only the
most recent one, and the previous quarter's file is no longer linked. Going by
the listing date of December 2013, some fifty quarterly files have been
published over the years.

1. Are the earlier NBINet quarterly files retained, and could they be made
   available in bulk, or sent?
2. If quarter-by-quarter is awkward, is there a single consolidated file
   covering the whole catalogue?
3. What does each quarterly file actually contain — newly catalogued records
   for that quarter, or some other selection? Knowing this would let me
   describe the data accurately rather than guess.

One practical note: from outside Taiwan, `www.ncl.edu.tw` returns
`503 Service Temporarily Unavailable` to us for everything, its homepage
included, while `isbn.ncl.edu.tw` works normally. A friend in Taiwan
downloaded the file on our behalf. If you are aware of that, or there is
another route, I would be glad to know.

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
