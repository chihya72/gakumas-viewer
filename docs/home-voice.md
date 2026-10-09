# 主页语音校对

入口：顶部“主页语音”，路径 `/home-voice`。页面按 voiceAssetId 将 ACB、OpenMOSS 日文和中文译文对应起来，支持角色筛选、ID/台词搜索、待复核筛选、日中编辑和已校对标记。

## 播放

点击播放时读取单个 ACB，在 Web Worker 中调用 vgmstream WebAssembly 解码，再将内存中的 WAV Blob 交给浏览器播放器。停止、切换语音、离开页面会释放当前音频和解析进程。不要求安装 Windows vgmstream，也不要求本地解码服务；不会上传、写入仓库或预生成 WAV。

`public/vgmstream-cli.js` 和 `.wasm` 来自 vgmstream 官方 [Web 构建](https://vgmstream.org/web/)，本次取得的构建版本为 2026-05-20，许可证见 `public/vgmstream-COPYING.txt`。Worker 调用方式参考上游 [vgmstream-web](https://github.com/KatieFrogs/vgmstream-web)。这三个解析文件不参与 PWA 预缓存，首次播放才加载。

## 本地校对

Chrome / Edge 可以打开 `Gakumas-Home-Voice-Translate` 项目根目录，并在用户授权目录读写后直接保存。只读取 `data/voices.json`、`data/subtitle_ui.json` 和点击播放的 `audio/acb/*.acb`，只写总表和 `exports` 下的文本文件；这些目录和文件必须已经存在，不自动创建目录。

其他浏览器可通过目录选择读取，在页面导出 `home_voice_review.csv`，再用本地 `python run.py` 第 6 项导入。目录选择只让页面读取文件，不把目录文件上传到任何服务。

开发时 `yarn dev` 可以只读访问现有的相邻语音项目。可用环境变量 `HOME_VOICE_PROJECT` 指定另一个现有目录；该开发接口没有 WAV 路径，也不提供写入操作。

## GitHub 校对

默认从公开仓库 `chihya72/Gakumas-Home-Voice-Translate` 的 `main` 分支读取，可在“GitHub 仓库”设置中改变。目标仓库需要先发布 ACB 和文本，本地目录模式不依赖仓库发布。

有写权限的用户可以使用 viewer 原有 GitHub 登录提交校对。保存时读取当前分支的总表，将未改动的其他语音保留，并把总表、日中 JSON/CSV 和完整中文 JSON 一次提交到原分支。提交只包含文本，不提交 ACB、WAV 或模型。目标 ID 若已被其他操作改变，会保留草稿并提示重新加载合并；分支引用采用非强制更新。

## 草稿与换行

编辑自动保存到本浏览器的草稿；“保存到本地项目”或“提交文本到 GitHub”才写回源数据。“撤销本条草稿”恢复本次载入的文本。

修改日文但未修改中文，会在保存时清空旧中文，等待本地流程重新翻译。若旧中文仍然正确，可勾选“确认保留当前中文”。日文人工校对标记为 `manual_viewer`，普通增量识别保留它。

CSV 中日中字段的换行使用字面量 `\n`；文本框显示实际换行，JSON 保留原有换行语义。导出校对 CSV 包含所有语音；正式中文字幕要求每条中文非空。仍有缺失中文时，保存总表与日中对照，但保留上一份完整的正式字幕文件。

OpenMOSS 识别、重新识别与付费机翻仍通过语音项目的 `run.py` 第 3、4、6 项执行。页面不加载 OpenMOSS 模型或翻译 API 密钥。

验证：`yarn check:home-voice` 检查 CSV 换行、日文变更、并发修改合并、本地文本保存和 GitHub 文本提交；`vue-tsc` 与 `vite build` 检查类型和发布构建。
