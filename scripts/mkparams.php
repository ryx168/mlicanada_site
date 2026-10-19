<?php
/**
 * Writes app/config/parameters.php for the on-demand admin container.
 *
 * The prestashop/prestashop image runs with PS_INSTALL_AUTO=0, so it never
 * writes this file - and without it index.php redirects EVERY request to
 * install/, relatively, so a client following redirects walks
 * /en/install/install/install/... until it gives up. The catalogue database is
 * already loaded by the workflow, so the correct move is to declare the
 * install finished, not to run the installer over live data.
 *
 * Usage: php scripts/mkparams.php <out-file>
 */
$out = isset($argv[1]) ? $argv[1] : 'parameters.php';

// new_cookie_key is NOT free-form. PrestaShop feeds it straight to
// Defuse\Crypto\Key::loadFromAsciiSafeString(), which wants that library's
// own checksummed-hex format - a base64 blob makes config.inc.php die with
// "Encoding::hexToBin() input is not a hex string" on EVERY request, shop and
// admin alike, as a blank 500. Only the defuse library can mint one, and it
// lives in the container's vendor/ tree, so the caller passes it in.
if (!isset($argv[2]) || $argv[2] === '') {
    fwrite(STDERR, "usage: mkparams.php <out-file> <new_cookie_key>
"
        . "  generate the key with, inside the PrestaShop container:
"
        . "  php -r 'require \"/var/www/html/vendor/autoload.php\";"
        . " echo Defuse\Crypto\Key::createNewRandomKey()->saveToAsciiSafeString();'
");
    exit(1);
}
$newCookieKey = $argv[2];

$p = array(
    'database_host'     => '127.0.0.1',
    'database_port'     => '3306',
    'database_name'     => 'jinwu_shop',
    'database_user'     => 'root',
    'database_password' => 'shoproot',
    'database_prefix'   => 'ps_',
    'database_engine'   => 'InnoDB',
    // 'mail' is NOT a valid transport: swiftmailer 6 dropped it, and the
    // admin's Symfony container then dies with
    // ServiceNotFoundException: non-existent service "mail" - a 500 on
    // /admin/ while the shop front renders perfectly. 'smtp' is what
    // PrestaShop's own parameters.yml.dist uses.
    'mailer_transport'  => 'smtp',
    'mailer_host'       => '127.0.0.1',
    'mailer_user'       => null,
    'mailer_password'   => null,
    'secret'            => bin2hex(random_bytes(16)),
    'ps_caching'        => 'CacheMemcache',
    'ps_cache_enable'   => false,
    'ps_creation_date'  => date('Y-m-d'),
    'locale'            => 'en-US',
    'use_debug_toolbar' => false,
    // Fresh keys are fine here: 1.7 hashes employee and customer passwords
    // with bcrypt, so nothing in the dump depends on these values. They only
    // invalidate cookies, and this container is thrown away anyway.
    // cookie_key is the legacy key and may be any random string; see the note
    // at the top for why new_cookie_key may not be.
    'cookie_key'        => bin2hex(random_bytes(28)),
    'cookie_iv'         => substr(bin2hex(random_bytes(8)), 0, 8),
    'new_cookie_key'    => $newCookieKey,
    'api_public_key'    => '',
    'api_private_key'   => '',
    'front_controllers' => array(),
);

$php = '<?php return ' . var_export(array('parameters' => $p), true) . ';' . PHP_EOL;
file_put_contents($out, $php);
echo 'wrote ' . $out . ' (' . strlen($php) . " bytes)\n";
