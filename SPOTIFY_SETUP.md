# Spotify — músicas dos padrinhos (Dani & Caio)

Implementação preparada em uma branch separada. **Não publicar o QR code até concluir o teste ponta a ponta.**

## O que foi implementado

- Página fixa para os padrinhos: /musicas.html (mesma linguagem visual do casamento, celular primeiro).
- Busca de músicas via Spotify, com até 8 resultados por consulta (limite do Spotify em 2026 é 10).
- Inclusão automática de músicas na playlist já existente: 2u5ZOx6YYH05UDJ9UE3oae.
- Registro de nome + música + artista + data em Redis; as 12 últimas escolhas aparecem no site.
- Proteção básica contra excesso de buscas, envios repetidos e inclusão duplicada.
- Autorização da conta Spotify feita uma única vez pelos noivos, sem login dos padrinhos.
- API de 2026: POST /playlists/{id}/items (o antigo endpoint /tracks não funciona em novos apps Development Mode).

## Configuração segura na Vercel

A aplicação **não funciona** até preencher as variáveis de ambiente do projeto correto na Vercel. Faça isso apenas pelo painel de Environment Variables do projeto, **nunca no GitHub, no chat ou no navegador dos convidados**.

| Variável | Valor |
|---|---|
| SPOTIFY_CLIENT_ID | 1aaa4eef7ece4e00bc2fa91376d67f88 (identificador público; já é o padrão no código) |
| SPOTIFY_CLIENT_SECRET | Client Secret exibido exclusivamente em Spotify for Developers |
| SPOTIFY_SETUP_KEY | Senha aleatória forte, criada por vocês, com pelo menos 16 caracteres |
| UPSTASH_REDIS_REST_URL | URL REST do Redis da integração Upstash vinculada ao projeto Vercel |
| UPSTASH_REDIS_REST_TOKEN | Token REST secreto da mesma integração |
| SPOTIFY_REDIRECT_URI | Por padrão, https://daniecaio.vercel.app/api/spotify/callback. Configure outro valor somente para testar em preview, e cadastre a mesma URL no Spotify. |

No dashboard Vercel, conecte um banco Upstash Redis ao projeto (Marketplace/Storage). Garanta que as variáveis UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN estejam disponibilizadas no ambiente de teste e, depois, no de produção. Se a integração Vercel criar aliases diferentes, crie os nomes acima apontando aos valores corretos.

### Autorização inicial

1. Confirme que o repositório e o deploy Vercel são os mesmos que hospedam daniecaio.vercel.app.
2. Teste a branch em uma implantação de **Preview**, sem alterar a produção.
3. Para autorizar na Preview, adicione a URL HTTPS exata da preview terminando em /api/spotify/callback como uma URL adicional em Spotify for Developers, e ajuste SPOTIFY_REDIRECT_URI no ambiente Preview. Atenção: URL de Preview dinâmica pode exigir atualização quando o endereço mudar.
4. Abra https://<preview>/spotify-setup.html, digite apenas ali a SPOTIFY_SETUP_KEY e clique em Autorizar conta Spotify. Faça login na conta proprietária da playlist.
5. O callback valida o estado da autorização (cookie HttpOnly), troca o código no servidor, confirma a conta proprietária e salva o refresh token em Redis. **Não há token secreto no navegador nem no repositório.**
6. Se o mesmo Redis for usado em Preview e Production, o refresh token já estará disponível quando a PR for aprovada e o deploy for feito. Senão, repita a autorização no domínio de produção.
7. Reative o bloqueio de acesso à página de setup em nível de Vercel, ou retire a página após conectar. A rota backend de setup recusa nova autorização quando já houver token persistido.

### Teste de aceitação obrigatório antes de publicar/gerar QR code

- [ ] Abrir /musicas.html num celular; visual e logo corretos.
- [ ] Buscar "Evidências" e um artista; conferir versão, capa e nome.
- [ ] Enviar uma música real com nome de teste; confirmar inclusão **uma única vez** na playlist original sem tocar nas demais.
- [ ] Repetir a mesma música; não gerar cópia, mas registrar quem a escolheu.
- [ ] Conferir nomes em "As músicas que vocês escolheram".
- [ ] Simular Redis desconectado: envio falha sem alterar playlist.
- [ ] Conferir mensagens em falhas Spotify 403, 429, token revogado e intervalo entre pesquisas.
- [ ] Conferir que nenhum segredo/token aparece em GitHub, navegador, resposta API ou logs.
- [ ] Validar domínio e link permanente /musicas.html; só então gerar QR code estático.
- [ ] Validar que o QR code abre corretamente de um dispositivo que não tem Spotify instalado.

## Pontos de atenção

- Spotify Development Mode exige Premium para a conta dona do app; permite até 5 contas Spotify **autenticadas**. Neste desenho, somente o dono da playlist se autentica; padrinhos acessam o seu próprio site sem autenticação Spotify. Os limites de quota/rate ainda se aplicam a todas as buscas e inclusões.
- Nenhum Spotify Client Secret é necessário no frontend.
- O limite por IP atual é 120 pesquisas a cada 10 minutos e 15 envios por hora, com registro de duplicatas. Proteção contra abuso intencional em um QR compartilhável pode exigir CAPTCHA/convites individuais antes de abrir a público amplo.
- O registro de nomes fica no Redis e é exibido publicamente no próprio site; comunicar isso aos padrinhos.
- Não há painel administrativo dedicado neste primeiro corte. As escolhas ficam visíveis na página, e o histórico pode ser consultado diretamente no Redis.
- Há possibilidade de músicas já existentes na playlist **antes do lançamento** serem sugeridas novamente, pois a desduplicação da primeira versão considera os envios feitos por esta página.
- Se o Spotify rotacionar o refresh token, o novo valor é salvo em Redis.
- Não imprimir o QR code nem mergear até testar manualmente a conexão OAuth e as permissões reais.

Documentação oficial:
- https://developer.spotify.com/documentation/web-api/tutorials/code-flow
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
