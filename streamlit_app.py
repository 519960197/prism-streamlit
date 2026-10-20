import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path

st.set_page_config(
    page_title="PRISM · 事件研判工作台",
    page_icon="🧭",
    layout="wide",
    initial_sidebar_state="collapsed",
)

html_path = Path(__file__).parent / "app.html"
html = html_path.read_text(encoding="utf-8")

components.html(html, height=5200, scrolling=True)
