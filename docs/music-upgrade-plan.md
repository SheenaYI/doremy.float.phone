# 音乐与一起听 改造计划

记录「音乐与一起听」四个功能的摸底结论、各部分完成后的具体效果、改造顺序，
以及出问题时的回退方法。

参考仓库：[Yyk-Y2k/ai-virtual-phone-Y2Kversion](https://github.com/Yyk-Y2k/ai-virtual-phone-Y2Kversion)（AGPL-3.0）

---

## 一、摸底结论：基础层已有，缺的是上层

| 能力 | 本仓库 | 上游 | 说明 |
|---|---|---|---|
| `lib/cover-color.ts`（封面取色）| **已有** | 有 | 引用数两边都是 2，基础已在用 |
| `lib/music-bg.ts`（磨砂背景）| **已有** | 有 | 引用数两边都是 3，支持 cover/follow/custom |
| `components/music/music-app.tsx` | 1933 行 | 1933 行 | **完全一致** |
| `styles/music.css` | 4988 行 | 5571 行 | 上游多 39 个选择器，是**新增块**而非改动 |
| `components/music/music-float.tsx` | 232 行 | 274 行 | 已挂载、已可拖动，缺一起听状态部分 |
| `lib/lyric-card-color.ts` | 已移植（阶段1）| 76 行 | 歌词卡取色 |
| `lib/lyric-selection.ts` | 已移植（阶段1）| 15 行 | 歌词范围选择 |
| `components/music/listening-presence.tsx` | **缺失** | 102 行 | 胶囊浮窗/成员面板 |
| `components/music/lyric-share-card.tsx` | **缺失** | 26 行 | 歌词卡组件 |
| `components/chat/share-destination-sheet.tsx` | **缺失** | 168 行 | 分享目标选择（私聊/群聊/朋友圈）|

**关键结论**：封面取色与磨砂背景不是从零开发，而是把已有基础接到界面上。
上游还带了 8 个验证脚本，可作为行为参照。

---

## 二、各部分完成后的具体效果

### ① 音乐页面美化

- 播放页背景采用**封面取色 + 磨砂**（复用已有 `cover-color` / `music-bg`）
- 播放器支持**封面 / 歌词切换**，歌词高亮当前句并可选中
- 评论区采用磨砂玻璃质感
- **只改观感，不加新功能**

### ② 音乐与歌词分享

- 聊天内点「一起听」面板的**音乐 tab 即完整音乐页**，可搜索、点歌，并把某首歌**直接分享进当前聊天**
- 面板第二个 tab 查看**角色歌单**（需角色卡有歌单数据）
- 在播放器里**长按 / 拖动选中一句或一段歌词** → 生成**取色歌词卡**（背景与文字色取自该曲封面）→ 可**附言** → 选择发到**私聊 / 群聊 / 朋友圈**
- 歌词卡在聊天里可点击播放；在朋友圈作为配图卡片渲染

### ③ 一起听邀请

- **逻辑已完成**：双向邀请、协议标记解析、接受 / 拒绝 / 退出
- **卡片已完成**（阶段2）：唱片封套视觉，右滑接受、左滑拒绝、唱片滑动动画，卡片底部保留退出入口
- 双方都可发起：用户走富媒体菜单的「一起听」；角色靠输出 `[一起听邀请:歌名|歌手]`

### ④ 持续一起听

- **胶囊浮窗**显示「正在和X一起听」，可展开出播放控制、点 × 收起、整个胶囊可拖动
- 浮窗点开有**成员面板**：两人头像 + 状态 + 结束按钮
- **切歌后仍在一起听**，并沿原队列续播下一首（不再变成"一个人听"）
- 角色的提示词每轮都能拿到「在听什么、是否暂停」，因此后续聊天里它知道自己和你在一起听
- 用户分享的歌词同样进入对话上下文

> **注意**：胶囊浮窗**不是聊天窗口**。它只有封面、歌名歌手、一起听状态、上一首/播放/下一首、
> 以及展开后的收起按钮。邀请与接受仍然发生在聊天的消息卡片里。

---

## 三、改造顺序与成本

顺序按「先可验证、后靠眼」排，把外观风险最高的一块放最后。

| 阶段 | 内容 | 成本 | 状态 |
|---|---|---|---|
| 0 | 保留对照克隆 + 固化回归测试 | 低 | **已完成** |
| 1 | 纯逻辑：歌词取色、歌词范围选择 | 低 | **已完成** |
| 2 | 邀请卡唱片封套手势版 + 其样式 | 低-中 | **已完成** |
| 3 | 持续一起听：`handleTrackEnd` 队列续播 + 胶囊浮窗 + 成员面板 | 中 | 待做 |
| 4 | 音乐与歌词分享：选歌面板、歌词卡、分享分发 | 中 | 待做 |
| 5 | 音乐页面美化（样式挑拣 + 外观打磨）| **高** | 待做 |

主要风险集中在阶段 5：`components/music/music-player.tsx` 两仓库已分叉（差异 1549 行），
只能按功能逐个比对移植，**且外观无法自动验证，必须人工目测**。

---

## 四、Todo List

### 阶段 0 —— 准备与测试（已完成）
- [x] 保留 `y2k` 对照克隆（`/Users/apple/Downloads/float/y2k`）
- [x] 评估上游验证脚本的可移植性，固化为 `check:lyric`、`check:listen`、`check:invite`

### 阶段 1 —— 纯逻辑（已完成）
- [x] 移植 `lib/lyric-card-color.ts`
- [x] 移植 `lib/lyric-selection.ts`
- [x] 回归测试 `npm run check:lyric`（26 条断言）

### 阶段 2 —— 邀请卡手势版（已完成）
- [x] 提取并追加邀请卡与唱片视觉的 CSS（含唱片旋转关键帧）
- [x] 按钮版改为唱片封套手势版（右滑接受 / 左滑拒绝）
- [x] 保留退出入口，键盘等价操作
- [x] 一致性检查 `npm run check:invite`

### 阶段 3 —— 持续一起听
- [ ] `lib/music-context.tsx` 的 `handleTrackEnd`：共听状态下沿原队列续播
- [ ] 移植 `components/music/listening-presence.tsx`（状态钩子、头像对、波浪环、成员面板）
- [ ] 扩展 `music-float.tsx`：显示一起听状态，保留拖动 / 展开 / 收起
- [ ] 补 `listening-planets` / `listening-ring` 等浮窗样式

### 阶段 4 —— 音乐与歌词分享
- [ ] 移植 `lyric-share-card.tsx` + 其 module.css
- [ ] 在 `music-player.tsx` 接入选句交互（`lyricRange` → `selectedLyric`）
- [ ] 移植 `share-destination-sheet.tsx`（选私聊 / 群聊 / 朋友圈）
- [ ] `message-bubble.tsx` 渲染歌词卡
- [ ] `moment-post-card.tsx` 渲染歌词卡（朋友圈）
- [ ] `chat-music-panel.tsx` 扩展为上游版（内嵌音乐页选歌 + 角色歌单 tab）
- [ ] `chat-room.tsx` 接收 `lyricQuote` 并生成待发草稿

### 阶段 5 —— 音乐页面美化
- [ ] 挑出并移植 `mp-apple` 播放器外壳相关选择器
- [ ] 挑出并移植歌词相关 `mp-lyric-*` 选择器（含选中态）
- [ ] 挑出并移植 `mcmt-frost` 评论区磨砂
- [ ] `music-player.tsx` 加封面 / 歌词切换
- [ ] 把 `cover-color` / `music-bg` 接到新外壳

### 阶段 6 —— 验证与交付
- [ ] 每阶段 `tsc` 对比基线（35）确认零新增
- [ ] 每阶段 `next build`（用 `NEXT_DIST_DIR` 独立目录，并还原 `next-env.d.ts` / `tsconfig.json`）
- [ ] 起 dev 供人工目测（外观相关项）
- [ ] 分阶段提交推送

---

## 五、回退手册

### 提交与功能的对应

| 提交 | 内容 |
|---|---|
| `9793346` | **阶段 2**：邀请卡改为唱片封套手势版 + 其样式 |
| `d4cd2b7` | **阶段 0**：修正捕获契约（普通发言不带歌词上下文）+ 固化回归测试 |
| `cbb908c` | **阶段 1**：移植歌词卡取色与歌词范围选择 |
| `43b4f5f` | 一起听：用户侧退出入口 + 预设说明 |
| `65294dc` | 一起听：双向邀请主体（16 文件）|
| `56b74b4` | 用量统计卡片玻璃图标 |
| `47a843a` | 移除余额查询，改双口径计费 |
| `2cfad03` | 用量统计（日历 / 按次计费）|
| `920fb5e` | vn-player 类型修复 |
| `1e95675` 及更早 | 记忆宫殿等内容（本次改造之前）|

阶段 3、4、5 的提交待做，完成后追加到本表。

### 方式 A：反向提交（推荐，随时可再撤销）

```bash
cd /Users/apple/Downloads/float/merged
git revert --no-commit <提交SHA>
git commit -m "revert: 暂时移除 <功能>"
```

代码退回，历史保留。将来想恢复，再 revert 一次那个 revert 即可。

### 方式 B：直接回到某个点

```bash
git tag before-music-upgrade <SHA>    # 先留后路
git reset --hard <SHA>
git push --force-with-lease origin main
```

改动从历史中消失。**操作前务必先打标签。**

### 已知的交叉依赖

- `47a843a` 与 `2cfad03` 交叉（前者删除后者新增的余额功能）。若要退掉用量统计而非
  只退余额，需同时处理这两个提交。
- `65294dc` 内含按钮版邀请卡，已被阶段 2（`9793346`）替换为手势版。
  若要退掉一起听整体，两个提交都要退；只想退回按钮版，则单独 revert 阶段 2。

---

## 六、本地开发提示

- **`y2k` 克隆每个阶段都要用于对照，先别删**（用完再拉约一两分钟）。
- **跑构建前必须先停掉 dev 服务。** 这一条是实测纠正过的：
  - 只设 `NEXT_DIST_DIR` 指向独立目录**并不够**。实测在 dev 运行时带独立目录跑构建，
    dev 仍会坏掉（`SyntaxError: Unexpected end of JSON input`，读取构建写过的
  manifest），页面随即 500。
  - 正确顺序：先停 dev → 再构建 → 用完清理 `.next-verify` 并还原配置。
  ```bash
  rm -rf .next-verify
  NEXT_DIST_DIR=.next-verify npx next build
  git checkout HEAD -- next-env.d.ts tsconfig.json && rm -rf .next-verify
  ```
  构建会把 `.next-verify` 写进 `next-env.d.ts` 与 `tsconfig.json`，用完必须还原，
  否则留下指向不存在路径的引用。
- **`.next` 被写坏后必须删掉再起 dev**，仅重启进程不够（残留的坏 manifest 会继续报错）。
- 质量闸门：`tsc` 基数为 **35 个既有错误**，任何阶段都不应超过；
  `npm run check:lyric` / `check:listen` / `check:invite` 应全部通过。

## 七、已知的跨文件耦合（改动时容易漏）

这两处的共同点：**出错时页面看起来"只是有点不对"，不会报错**，因此都配了断言。

1. **消息类型 → 样式脱壳**
   邀请卡是一张独立卡片，不该套聊天气泡的壳。链路是两段：
   `chat-room.tsx` 的气泡外层写 `data-media-type={renderMsg.mediaType || "text"}`，
   `styles/music.css` 用 `.chat-room-wrapper [data-media-type="listening_invite"]` 清掉
   气泡的底/内边距/阴影/边框。**两段缺一不可**，且属性值必须与落库的 `mediaType` 一致。
   由 `check:invite` 守护。

2. **协议标记 → 解析链路有两条**
   `applyListeningRoomReply` 必须在**两条** AI 回复解析路径上都调用，只接一条会让标记
   漏成可见正文：
   - `components/chat/chat-room.tsx` 的 `splitAndSaveAIMessages` —— **私聊主路径**
   - `lib/follow-up-service.ts` 的 `parseAndSaveResponse` —— 后台生成与推送链路
   目前 `check:listen` 守护的是捕获契约；「标记不漏出」尚无自动断言，改动这两处后需人工确认。

### 关于 `data-media-type` 的影响范围

上游还有多处依赖该属性的样式规则，但它们全在 `styles/imessage26.css`（iMessage 主题）里，
本仓库尚未移植，故当前对文字 / 音频 / 引用等其它消息类型**没有影响**。
阶段 5 若移植该主题，必须把那些规则一并带入，否则气泡外观会被带偏。

