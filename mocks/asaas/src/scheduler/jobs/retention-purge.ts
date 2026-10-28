/**
 * Job 8 — retenção da fila de webhooks.
 *
 * O Asaas guarda a fila por um tempo finito: o que não foi entregue dentro da
 * janela de retenção (WEBHOOK_RETENTION_DAYS, default 14 DIAS SIMULADOS) não é
 * entregue nunca mais. Sem isto, um `advance({ days: 400 })` acumularia entregas
 * PENDING para sempre e a fila viraria um cemitério que o dispatcher varre a cada
 * tick.
 *
 *   PENDING  além da retenção → EXPIRED  (não se entrega passado remoto)
 *   DELIVERED além da retenção → some    (o log de entregas é log, não arquivo)
 *   Logs de Requisições além das últimas REQUEST_LOG_LIMIT da conta → somem
 *
 * INTERRUPTED NÃO é purgado: é justamente o estado que o dev precisa ver ao
 * investigar por que a fila travou — e é o que o removeBackoff destrava.
 *
 * Roda DEPOIS do dispatcher: uma entrega que vence e expira no mesmo tick ainda
 * teve sua chance.
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import { webhookDeliveries } from '../../db/schema/index.ts'
import { REQUEST_LOG_LIMIT } from '../../http/request-log.ts'
import type { Job } from '../scheduler.ts'

export const retentionPurge: Job = {
  name: 'retention-purge',
  async run({ ctx }) {
    const now = ctx.clock.nowMs()

    // Compare-and-swap no status: rodar duas vezes no mesmo instante altera zero
    // linhas na segunda.
    await ctx.db
      .update(webhookDeliveries)
      .set({ status: 'EXPIRED', nextAttemptAtMs: null })
      .where(
        and(
          eq(webhookDeliveries.status, 'PENDING'),
          lt(webhookDeliveries.expiresAtMs, now),
        ),
      )

    await ctx.db
      .delete(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, 'DELIVERED'),
          lt(webhookDeliveries.expiresAtMs, now),
        ),
      )

    // Logs de Requisições: the newest REQUEST_LOG_LIMIT calls of each account. A
    // count, not a window of simulated days: a jump of the clock must not wipe
    // the calls the developer is looking at.
    await ctx.db.run(sql`
      delete from request_logs where id in (
        select id from (
          select id, row_number() over (partition by account_id order by id desc) as position
          from request_logs
        ) where position > ${REQUEST_LOG_LIMIT}
      )`)
  },
}
