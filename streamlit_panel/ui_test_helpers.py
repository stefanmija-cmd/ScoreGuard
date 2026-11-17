"""Read the operator's rendered HTML table in Streamlit AppTest."""

from html.parser import HTMLParser
import pandas as pd


class ScoreTableParser(HTMLParser):
    def __init__(self, markup):
        super().__init__()
        self.headers = []
        self.rows = []
        self.differences = []
        self.cells = []
        self.cell = None
        self.highlight = None
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.cells = []
        if tag in ("td", "th"):
            self.cell = []
        if tag == "strong" and "sg-score-diff" in attrs.get("class", "").split():
            self.highlight = {
                "row": len(self.rows),
                "column": self.headers[len(self.cells)],
                "part": attrs["data-part"],
                "value": "",
            }

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
        if self.highlight is not None:
            self.highlight["value"] += data

    def handle_endtag(self, tag):
        if tag == "strong" and self.highlight is not None:
            self.differences.append(self.highlight)
            self.highlight = None
        if tag in ("td", "th"):
            value = "".join(self.cell)
            if tag == "th":
                self.headers.append(value)
            else:
                self.cells.append(value)
            self.cell = None
        if tag == "tr" and self.cells:
            self.rows.append(self.cells)

    def frame(self):
        frame = pd.DataFrame(self.rows, columns=self.headers)
        if "Spiskova" in frame:
            frame["Spiskova"] = frame["Spiskova"].astype(int)
        return frame


def rendered_table(app, table_id="sg-monitor"):
    return next(
        item.proto.body for item in app.get("html") if 'id="' + table_id + '"' in item.proto.body
    )


def score_table(app, table_id="sg-monitor"):
    return ScoreTableParser(rendered_table(app, table_id)).frame()
