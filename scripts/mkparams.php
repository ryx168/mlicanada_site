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

$p = array(
    'database_host'     => '127.0.0.1',
    'database_port'     => '3306',
    'database_name'     => 'jinwu_shop',
    'database_user'     => 'root',
    'database_password' => 'shoproot',
    'database_prefix'   => 'ps_',
    'database_engine'   => 'InnoDB',
    'mailer_transport'  => 'mail',
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
    'cookie_key'        => bin2hex(random_bytes(28)),
    'cookie_iv'         => substr(bin2hex(random_bytes(8)), 0, 8),
    'new_cookie_key'    => base64_encode(random_bytes(32)),
    'api_public_key'    => '',
    'api_private_key'   => '',
    'front_controllers' => array(),
);

$php = '<?php return ' . var_export(array('parameters' => $p), true) . ';' . PHP_EOL;
file_put_contents($out, $php);
echo 'wrote ' . $out . ' (' . strlen($php) . " bytes)\n";
