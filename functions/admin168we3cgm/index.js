// Binds the launcher to /admin168we3cgm. Logic lives in functions/_launcher.js.
import { launcherGet, launcherPost } from '../_launcher.js';

export const onRequestGet = launcherGet;
export const onRequestPost = launcherPost;
