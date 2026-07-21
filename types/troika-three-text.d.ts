declare module "troika-three-text" {
  export function configureTextBuilder(config: {
    useWorker?: boolean;
    now?: () => number;
    unicodeFontsURL?: string;
  }): void;
}
