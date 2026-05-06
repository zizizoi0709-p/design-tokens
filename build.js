import StyleDictionary from 'style-dictionary';
import { register } from '@tokens-studio/sd-transforms';
import config from './style-dictionary.config.js';

register(StyleDictionary);

try {
  const sd = new StyleDictionary(config);
  await sd.cleanAllPlatforms();
  await sd.buildAllPlatforms();
  console.log('\n✔ Build complete: build/ios/');
} catch (err) {
  console.error('\n✖ Build failed.');
  if (err && err.stack) {
    console.error(err.stack);
  } else {
    console.error(err);
  }
  process.exit(1);
}
