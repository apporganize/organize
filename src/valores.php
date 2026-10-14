<?php
declare(strict_types=1);

const MESES_MAX = 60;                          // máximo de meses de uma série "todo mês"
const ESCOPOS = ['esta', 'proximas', 'todas']; // o que excluir numa série

/**
 * Leitura e conta de valores, datas e inteiros vindos do JSON (usado por despesas e receitas).
 * Todas as funções de leitura devolvem o valor já validado ou encerram com erro 422.
 */

/** Valor em reais: aceita número ou texto "187.40"; no máximo 2 casas e maior que zero. Devolve "187.40". */
function valor_param(mixed $valor): string
{
    $mensagem = 'Informe um valor maior que zero, com no máximo 2 casas decimais.';

    if (is_int($valor) || is_float($valor)) {
        $valor = number_format((float) $valor, 2, '.', '');
    } elseif (!is_string($valor)) {
        json_error($mensagem, 422);
    }

    $valor = trim($valor);
    if (!preg_match('/^[0-9]{1,10}(\.[0-9]{1,2})?$/', $valor) || (float) $valor <= 0) {
        json_error($mensagem, 422);
    }
    return number_format((float) $valor, 2, '.', '');
}

function data_param(mixed $data, string $mensagem): string
{
    if (!is_string($data) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $data, $p)) {
        json_error($mensagem, 422);
    }
    if ((int) $p[1] < 2000 || (int) $p[1] > 2100 || !checkdate((int) $p[2], (int) $p[3], (int) $p[1])) {
        json_error($mensagem, 422);
    }
    return $data;
}

function uuid_valor(mixed $valor, string $mensagem): string
{
    $formato = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
    if (!is_string($valor) || !preg_match($formato, $valor)) {
        json_error($mensagem, 422);
    }
    return strtolower($valor);
}

/** Inteiro entre $min e $max vindo do JSON (número inteiro ou texto só com dígitos). */
function inteiro_param(mixed $valor, int $min, int $max, string $mensagem): int
{
    if (is_string($valor) && preg_match('/^[0-9]{1,3}$/', $valor)) {
        $valor = (int) $valor;
    }
    if (!is_int($valor) || $valor < $min || $valor > $max) {
        json_error($mensagem, 422);
    }
    return $valor;
}

/**
 * Soma meses a uma data AAAA-MM-DD sempre a partir da data original (31/01 + 1 mês = 28/02,
 * mas + 2 meses = 31/03). Se o dia não existir no mês, usa o último dia dele.
 */
function somar_meses(string $data, int $meses): string
{
    [$ano, $mes, $dia] = array_map('intval', explode('-', $data));
    $indice = $ano * 12 + ($mes - 1) + $meses;
    $anoFinal = intdiv($indice, 12);
    $mesFinal = $indice % 12 + 1;
    $ultimoDia = (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $anoFinal, $mesFinal)))->format('t');
    return sprintf('%04d-%02d-%02d', $anoFinal, $mesFinal, min($dia, $ultimoDia));
}

function uuid_v4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $hex = bin2hex($b);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-'
        . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}

/** Primeiro dia do mês pedido e do mês seguinte. */
function intervalo_do_mes(): array
{
    $mes = $_GET['mes'] ?? '';
    if (!is_string($mes) || !preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $mes, $p)
        || (int) $p[1] < 2000 || (int) $p[1] > 2100) {
        json_error('Mês inválido. Use o formato AAAA-MM.', 422);
    }
    $inicio = new DateTimeImmutable($mes . '-01');
    return [$inicio->format('Y-m-d'), $inicio->modify('+1 month')->format('Y-m-d')];
}