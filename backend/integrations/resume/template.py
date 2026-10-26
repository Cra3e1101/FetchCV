"""Layout preset measured from the user's didi/main.tex (no personal content)."""

DIDI_TEMPLATE = "didi"


def didi_settings() -> dict:
    """Return fresh CSS-pixel settings for the A4, 10.2pt resume preset."""
    return {
        "templatePreset": "didi-v2",
        "margin": 48,  # 1.27 cm at 96 dpi
        "spacing": 0.8 * 96 / 25.4,
        "lineHeight": 14.6 / 10.2 * 100,
        "fontSize": 10.2 * 96 / 72.27,  # TeX pt (72.27/in), not CSS pt (72/in)
        "fontFamily": "'Times New Roman', 'SimSun', 'Songti SC', serif",
        "nameSize": 18 * 96 / 72.27,
        "basicHeight": 100.8,
        "infoColumns": 3,
        "titleStyle": "line",
        "fitScale": 1,
        "verticalFillGap": 0,
        "photoX": 0,
        "photoY": 0,
        "nameX": 0,
        "infoX": 0,
        "infoY": 0,
        "customAccent": "#161616",
        "customAccent2": "#161616",
        "customStage": "#eeefed",
    }
