// ACT: DeltaDesigner Media Provider — 代理到 Next.js /api/image-generation/generate
// Credits 扣费、Provider Factory、S3 存储全由 DeltaDesigner 处理
const rules = [
  {
    type: "input",
    field: "deltaDesignerUrl" as const,
    title: "DeltaDesigner 地址",
    value: "http://127.0.0.1:3000",
    props: { type: "text", autocomplete: "off" },
  },
  {
    type: "input",
    field: "deltaInternalToken" as const,
    title: "内部认证 Token",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

function urlOf(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

function toDeltaRatio(ratio?: string) {
  if (!ratio) return "auto";
  const supported = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];
  return supported.includes(ratio) ? ratio : "auto";
}

function toDeltaSize(size?: string) {
  if (!size) return "1K";
  const upper = size.toUpperCase();
  if (["1K", "2K", "4K"].includes(upper)) return upper as "1K" | "2K" | "4K";
  return "1K";
}

function mediaAssetFromUrl(url: string, mimeType?: string): MediaAsset[] {
  return [{ mediaType: "image", type: "url", url, ...(mimeType ? { mimeType } : {}) }];
}

export default {
  id: "deltaDesigner" as const,
  label: "DeltaDesigner",
  version: "1.0.0",
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzYxRUZGNNiI+CjxwYXRoIGQ9Ik0xMiAyQzYuNSAyIDEgNi41IDEgMTJzNC41IDEwIDExIDEwIDExLTQuNSAxMS0xMSBDMTcgNi41IDEzLjUgMiAxMiAyIG0wIDJjNC45IDAgOS40IDQuNSA5LjQgMTAgMCA1LjUtNC41IDktOS40IDkgLTVuNiAwLTkuNC00LjUtOS40LTkgMC01LjUgNC41LTkgOS40LTlpIDkgMCAwIDEgMCAwWiIvPgo8L3N2Zz4=",
  readme: "## DeltaDesigner 内部代理\n\n图片生成请求转发到 DeltaDesigner 的统一生成接口，由其处理 Credits 扣费、Provider Factory 路由和 S3 存储。\n\n需要配置 `DELTA_DESIGNER_URL`（默认 http://127.0.0.1:3000）和 `DELTA_INTERNAL_TOKEN`（与 DeltaDesigner 共享）。",
  rules,
  // ACT: 模型列表硬编码一批常用的；真正的模型能力由 DeltaDesigner 后端决定
  models: [
    {
      id: "doubao-seedream-5.0-Pro",
      label: "Doubao Seedream 5.0 Pro",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
    },
    {
      id: "doubao-seedream-5.0-Lite",
      label: "Doubao Seedream 5.0 Lite",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
    },
    {
      id: "nano-banana",
      label: "Nano Banana",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["1K", "2K", "4K"],
      imageRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
    },
    {
      id: "kwai-kolors",
      label: "Kwai-Kolors",
      type: "image",
      mode: ["text"],
      imageSizes: ["1K"],
      imageRatios: ["1:1"],
    },
    {
      id: "cogview-3-flash",
      label: "CogView 3 Flash",
      type: "image",
      mode: ["text"],
      imageSizes: ["1K"],
      imageRatios: ["1:1"],
    },
  ] satisfies ProviderModel[],

  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const baseUrl = String(this.config.deltaDesignerUrl || "http://127.0.0.1:3000").replace(/\/$/, "");
    const internalToken = typeof this.config.deltaInternalToken === "string" ? this.config.deltaInternalToken : "";

    const authToken = this.tool.getAuthToken ? this.tool.getAuthToken() : undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // ACT: 优先用 internal token，带上 _deltaUserId；否则带 cookie 让 DeltaDesigner 自己解 JWT
    if (internalToken) {
      headers["X-Internal-Token"] = internalToken;
    }
    if (authToken) {
      headers["Cookie"] = `auth_token=${authToken}`;
    }

    const body: Record<string, unknown> = {
      prompt: request.prompt,
      model: request.model,
      aspectRatio: toDeltaRatio(request.ratio),
      imageSize: toDeltaSize(request.size),
      numImages: 1,
    };
    const refs = (request.images ?? []).map(urlOf);
    if (refs.length > 0) body.referenceImages = refs;

    const signal = this.signal;
    signal?.throwIfAborted();
    const response = await this.tool.fetch(`${baseUrl}/api/image-generation/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 402) {
      throw new Error("积分不足，请前往 DeltaDesigner 充值或激活");
    }
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`DeltaDesigner 生成失败（HTTP ${response.status}）: ${err.slice(0, 500)}`);
    }
    const result = await response.json();
    if (!result.success || !Array.isArray(result.images) || !result.images.length) {
      throw new Error(result.error || "DeltaDesigner 未返回生成结果");
    }
    const url = result.images[0]?.imageUrl;
    if (typeof url !== "string" || !url.trim()) throw new Error("DeltaDesigner 返回了空结果");
    return mediaAssetFromUrl(url.trim());
  },
} satisfies ProviderDefinition<typeof rules>;
