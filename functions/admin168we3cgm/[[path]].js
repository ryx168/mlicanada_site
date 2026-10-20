// Anything UNDER /admin168we3cgm/ - old bookmarks such as
// /admin168we3cgm/index.php?controller=AdminDashboard - lands on the launcher
// rather than a Pages 404, so a stale bookmark still gets the owner in.
import { launcherGet, launcherPost } from '../_launcher.js';

export const onRequestGet = launcherGet;
export const onRequestPost = launcherPost;
