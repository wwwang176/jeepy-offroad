# Low-Poly Jeep Off-Road

[English](README.md) | **中文**

瀏覽器越野小遊戲：低面數吉普車、程序化路線、三種地形。衝到終點——或只是享受亂爬的樂趣。

## 截圖

### 沙地
![沙地車道 — 後方跟拍](docs/screenshots/sand-trail-rear.jpg)

![沙地側坡與胎痕](docs/screenshots/sand-side-slope.jpg)

### 雨林
![雨林雨中車道](docs/screenshots/rainforest-trail.jpg)

### 雪山
![雪山稜線](docs/screenshots/alpine-ridge.jpg)

![雪山下坡與吹雪](docs/screenshots/alpine-descent.jpg)

## 特色

- **程序化地圖** — 每次都是通往終點的新路線
- **三種地形**
  - **沙地** — 乾燥岩脊、仙人掌、易滑砂礫
  - **雨林** — 濕泥、降雨、成片椰子樹
  - **雪山** — 長下坡、裸岩、吹雪氣流
- **4H / 4L 分動箱** — 高速巡航用 4H，爬坡與檔煞用 4L
- **胎痕、塵土／泥水／雪霧**，以及各地形天氣
- **小地圖 + 終點指示**，較不容易迷路
- **桌機與手機** — 鍵盤或虛擬搖桿／踏板
- **EN / 中文** 主選單語言切換

## 線上遊玩

https://wwwang176.github.io/jeepy-offroad/

## 操作

| | 桌機 | 手機 |
|--|------|------|
| 駕駛 | WASD / 方向鍵 | 搖桿 + 踏板 |
| 剎車 | W+S（反向） | 剎車踏板 |
| 4H ↔ 4L | Shift | RANGE |
| 鏡頭 | C · 拖曳環視 | 鏡頭鈕 · 拖曳 |
| 重生 | R | R |
| 選單 | Esc / 選單鈕 | 選單（小地圖左側） |

## 本機執行

- `npm run dev` — 本機開遊戲
- `npm test` — 單元測試
- `npm run build` — 正式建置
- `npm run preview` — 預覽正式建置（base path `/jeepy-offroad/`）
