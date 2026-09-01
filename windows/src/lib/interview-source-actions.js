export async function openOriginalInterviewSource(source) {
  const url = String(source?.source_url || source?.url || "");
  if (!url) throw new Error("缺少面经原帖地址");
  if (window.appRuntime?.openInterviewSource) {
    try {
      const result = await window.appRuntime.openInterviewSource({
        url,
        title: String(source?.title || "").slice(0, 300),
        company: String(source?.company || "").slice(0, 240),
        businessUnit: String(source?.business_unit || source?.businessUnit || "").slice(0, 240),
        role: String(source?.role || "").slice(0, 240),
      });
      if (result?.unavailable) {
        window.dispatchEvent(new CustomEvent("fetchcv:notice", {
          detail: {
            type: "error",
            message: "这篇原帖已经失效或无法恢复公开访问，FetchCV 已阻止打开失效页面。",
          },
        }));
      }
      return result;
    } catch (error) {
      window.dispatchEvent(new CustomEvent("fetchcv:notice", {
        detail: {
          type: "error",
          message: error?.message || "未能打开面经原帖。",
        },
      }));
      return { opened: false, error: true };
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return { opened: true, accessRefreshed: false };
}
