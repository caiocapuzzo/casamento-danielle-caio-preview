# Presentes do casamento: acompanhamento privado

O projeto mantém o checkout anterior se nenhuma flag nova estiver ativa. O painel só consulta o histórico de pagamentos confirmados pelo servidor; nenhum pagamento antigo é importado automaticamente. CSV e recursos de presença continuam separados. Não há leitura de dados do comprador na aba (nome, e-mail, telefone, recibos e identificadores brutos da transação não são persistidos). O comprador ainda pode compartilhar os mesmos dados opcionais com a InfinitePay no checkout.

## Configuração de produção

1. Publique o código sem flags novas e confirme a aba de presentes desativada, o checkout preservado, as rotas novas de dados protegidas e as callbacks desativadas. A verificação deve usar apenas fixtures. A [InfinitePay não oferece sandbox](https://www.infinitepay.io/checkout-documentacao).
2. Depois da aprovação da ativação, reutilize as credenciais Redis já configuradas. Configure somente em Produção:
   - `WEDDING_GIFTS_TRACKING_ENABLED=true`: habilita callbacks, verificação e leitura autenticada. As rotas de callback só aceitam o domínio canônico `daniecaio.vercel.app`. A rota de retorno sanitiza e redireciona mesmo desligada.
   - `WEDDING_GIFTS_TRACKING_SINCE`: início real planejado da captura, timestamp UTC `YYYY-MM-DDTHH:mm:ssZ`, não no futuro quando o deploy começar a receber consultas. Exibe a referência de cobertura, não garante completude.
   - `WEDDING_GIFTS_CAPTURE_NEW=true`: habilita geração de novos links com tracking. Alterações de variáveis exigem novo deployment.
3. Para pausar novas capturas, desligue apenas `WEDDING_GIFTS_CAPTURE_NEW` e faça novo deployment. Deixe as duas outras variáveis e as rotas existentes ativas: links emitidos pela InfinitePay não podem trocar o webhook depois, e podem continuar válidos. Mantenha os registros e o histórico, não volte para um commit anterior ao webhook sem considerar reconciliação.
4. Se o armazenamento estiver fora do ar, chegue a um limite operacional ou se a captura estiver pausada, a loja continua abrindo checkout, mas esses pedidos podem não aparecer no painel. Confira as compras e os estornos diretamente na InfinitePay. Não reaproveite carrinhos ou links antigos como comprovantes.

## Critérios

- O preço de 57 itens deriva dos nomes e valores exibidos em `gifts.html` com o arredondamento do site. Mudanças futuras de catálogo devem atualizar os dois arquivos em conjunto, com o teste de paridade.
- O aviso sem assinatura e o retorno são sinais, não confirmação. A consulta oficial com quatro identificadores confere `success`, `paid` e o valor original em centavos. O cupom/fees do processador ou a liquidação não são inferidos.
- A confirmação gravada é quando a checagem ocorreu, não a data exata da compra. O valor mostrado é o total dos itens do pedido, não valor líquido, status de estorno ou total com taxas da InfinitePay.
- Cada transação confirmada única fica em uma linha, mesmo se alguém pagar novamente pelo mesmo link. Reentregas da mesma transação não aumentam as contagens.
- Chaves Redis limitadas, separadas e não expostas a visitantes. Identificadores usados para deduplicação são hashes. Limites de escrita e consulta evitam crescimento indefinido; se necessário, revisar e reconciliar antes de alterar limites.
- `node --test gift-tests/gift-ledger.test.js`: fixture-only, nenhum POST real. Um diagnóstico em produção se limita a status sem credenciais/dados e conteúdo público. O primeiro pagamento real será do comprador, não um teste realizado por nós.
