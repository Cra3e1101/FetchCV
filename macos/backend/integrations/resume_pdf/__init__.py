__all__ = ["PdfResumeImporter"]


def __getattr__(name: str):
    if name != "PdfResumeImporter":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from .importer import PdfResumeImporter

    globals()[name] = PdfResumeImporter
    return PdfResumeImporter
