# PRISM · Streamlit Cloud 部署包

这是一个可以部署到 Streamlit Community Cloud 的事件研判工作台。当前版本保留原有 PRISM HTML UI，并由 `streamlit_app.py` 作为 Streamlit 入口加载。

## 部署步骤

1. 把整个 `prism-streamlit-cloud` 文件夹上传到一个 GitHub 仓库。
2. 打开 https://share.streamlit.io/ 并连接 GitHub。
3. 点击 **Create app**。
4. 选择仓库和分支，入口文件填写：

   `streamlit_app.py`

5. 点击 **Deploy**，等待生成 `*.streamlit.app` 地址。
6. 把这个地址发给评委。

后续更新只需要替换 `app.html` 或修改 `streamlit_app.py` 后提交到 GitHub，Streamlit Cloud 会自动重新部署。

## 当前能力

- 事件文字输入和本地规则初筛
- 风险等级判断
- 对话记录和后续处置记录
- 判断完成后上传案例数据和公关资源数据
- 在浏览器中筛选并比较上传条目
- 导出研判记录

## 后续接入 API

后续可以在 `streamlit_app.py` 中接入 API 或数据库。API Key 不要写进 HTML 或 GitHub 文件，应通过 Streamlit Cloud 的 Secrets 管理。

当前页面中的上传记录主要保存在浏览器本地；如果需要多人共享或跨设备保存，应再接入数据库或对象存储。
