import { resolve } from "node:path";
import { type FeatureExtractionPipeline, env, pipeline } from "@huggingface/transformers";
import type { EmbeddingProvider } from "./types.ts";

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  private extractor: FeatureExtractionPipeline | null = null;

  constructor(
    private modelId: string,
    private modelsDir: string,
  ) {}

  async init(): Promise<void> {
    if (this.extractor) {
      return;
    }

    env.cacheDir = resolve(this.modelsDir);
    const extractor = await pipeline("feature-extraction", this.modelId);
    this.extractor = extractor as FeatureExtractionPipeline;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      await this.init();
    }
    const output = await this.extractor!(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  dimensions(): number {
    return 384;
  }
}
