"""Shared page spacing, including the Community Cloud toolbar clearance."""


def page_styles(cloud_mode: bool = False) -> str:
    padding = "5rem" if cloud_mode else "2rem"
    mobile_padding = "5.5rem" if cloud_mode else "2rem"
    return f"""<style>
    .block-container {{ padding-top: {padding}; max-width: 1600px; }}
    @media (max-width: 640px) {{
        .block-container {{ padding-top: {mobile_padding}; }}
    }}
    div[data-testid="stMetric"] {{ background: #f5f9f3; border: 1px solid #e1eadb;
        border-radius: 9px; padding: 14px; }}
    h1 {{ letter-spacing: -1px; }}
    .stApp {{ background: #fbfcfa; }}
    </style>"""
