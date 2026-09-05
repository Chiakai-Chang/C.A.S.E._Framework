// Static import lets pi's native extension loader resolve the host SDK alias.
import * as sdk from '@earendil-works/pi-coding-agent';
import caseExtension from './extension-core.mjs';

export default function registerCase(pi) {
  return caseExtension(pi, sdk);
}
