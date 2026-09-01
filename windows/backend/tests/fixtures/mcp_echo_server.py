from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations


server = FastMCP("fetchcv-test")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
def echo(value: str) -> dict[str, str]:
    """Return the provided value without changing external state."""
    return {"value": value}


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True))
def mutate(value: str) -> dict[str, str]:
    """A deliberately mutating test tool that FetchCV must reject."""
    return {"value": value}


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False))
def mutate_resume(resume_id: str, value: str) -> dict[str, str]:
    """Test a scoped write call against one declared FetchCV resume version."""
    return {"resume_id": resume_id, "value": value}


if __name__ == "__main__":
    server.run(transport="stdio")
