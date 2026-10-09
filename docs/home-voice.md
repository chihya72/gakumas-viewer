# 主页语音校对

入口：顶部“主页语音”，路径 `/home-voice`。页面自动读取 `chihya72/Gakumas-Home-Voice-Translate` 的 `main` 分支，按 voiceAssetId 将 ACB、OpenMOSS 日文和中文译文对应起来。无需选择本地目录或设置仓库。

状态只有四项：全部、AI识别待复核、待校对、已校对。有识别错误、识别复核提示或缺少日文的未校对条目归入“AI识别待复核”；其他未校对条目归入“待校对”。成功完成校对后归入“已校对”。

## 播放

点击播放时读取单个 ACB，在 Web Worker 中调用 vgmstream WebAssembly 解码，再将内存中的 WAV Blob 交给浏览器播放器。停止、切换语音、离开页面会释放当前音频和解析进程。不要求安装 Windows vgmstream，也不要求本地解码服务；不会上传、写入仓库或预生成 WAV。

`public/vgmstream-cli.js` 和 `.wasm` 来自 vgmstream 官方 [Web 构建](https://vgmstream.org/web/)，本次取得的构建版本为 2026-05-20，许可证见 `public/vgmstream-COPYING.txt`。Worker 调用方式参考上游 [vgmstream-web](https://github.com/KatieFrogs/vgmstream-web)。这三个解析文件不参与 PWA 预缓存，首次播放才加载。

## GitHub 校对

上线后，所有语音数据直接来自固定的公开仓库：`data/voices.json`、`data/subtitle_ui.json` 和点击播放时读取的 `audio/acb/*.acb`。目标仓库需要先发布 ACB 和文本。

有写权限的用户使用 viewer 原有 GitHub 登录，然后点击“完成校对”。一次只保存当前这一条的日中内容，并写入 `reviewed: true` 和校对时间；文本没有修改也可以完成校对。成功提交前不改变已校对状态，其他条目的浏览器草稿保留。

保存时读取当前分支的总表，保留其他语音的最新内容，把总表、日中 JSON/CSV 和完整中文 JSON 一次提交到原分支。提交只包含文本。目标 ID 若已被其他操作改变，会保留草稿并提示合并；分支引用采用非强制更新。

## 草稿与换行

编辑自动保存到本浏览器的草稿；“完成校对”才写回仓库。页面没有已校对勾选栏，也没有 CSV 导入导出、字幕导出或撤销草稿按钮。

完成校对表示确认两个文本框中的内容，会一起保存日文和中文，不会因只改日文而清空已确认的中文。两个文本框均须非空。修改过的日文标记为 `manual_viewer`，普通增量识别保留它。

文本框显示实际换行；“查看本次载入的原稿”将换行还原为字面量 `\n`。仓库内日中 CSV 也使用字面量 `\n`，JSON 保留换行语义。正式中文字幕要求每条中文非空；仍有缺失中文时，保存总表与日中对照，保留上一份完整的正式字幕文件。

OpenMOSS 识别、重新识别与付费机翻仍通过语音项目的 `run.py` 第 3、4、6 项执行。页面不加载 OpenMOSS 模型或翻译 API 密钥。

开发预览可显式设置 `VITE_HOME_VOICE_LOCAL_PREVIEW=1`，只读使用现有的相邻语音项目，或用 `HOME_VOICE_PROJECT` 指定另一个现有目录。该测试接口没有 WAV 路径和写入操作；发布构建始终读取固定 GitHub 仓库。

验证：`yarn check:home-voice` 检查四类状态、原稿/CSV 换行、无修改校对、单条提交、并发修改合并和 GitHub 文本提交；`vue-tsc` 与 `vite build` 检查类型和发布构建。
