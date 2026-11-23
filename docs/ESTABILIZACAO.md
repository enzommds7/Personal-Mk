# Plano de estabilização — PersonalMk

## Regra de segurança
- Não importar nem publicar o backup privado do PC do trabalho no GitHub.
- Não alterar a branch `main` até a validação da sincronização.
- Fazer backup JSON em cada dispositivo antes de testes de migração.
- Não apagar armazenamento local, dados do PWA nem desinstalar o aplicativo durante os testes.

## Contrato de sincronização (alvo)
1. A gravação local é persistida antes de informar "salvo neste dispositivo".
2. "Sincronizado" só aparece após confirmação da gravação remota e ausência de pendências.
3. Edições offline ficam pendentes até reconexão, sem perda após recarregar a página.
4. Alterações simultâneas não são descartadas: preservar ambas as versões até resolução.
5. Exclusões usam tombstones com identificador/revisão para impedir ressurreição.
6. O PWA e o navegador compartilham o mesmo backend autenticado, embora cada instalação tenha cache local independente.
7. Imagens não podem fazer o localStorage estourar silenciosamente.

## Riscos confirmados na auditoria inicial
- `setDay` inicia `cloudSaveDay` sem aguardar a Promise. Portanto o editor pode mostrar "salvo" antes de confirmação remota.
- `cloudSaveDay` usa `serverTimestamp()`, enquanto o merge compara `updatedAt` com o relógio local. Diferenças de relógio e respostas fora de ordem podem escolher versões incorretas.
- `shouldDeferRemoteDay` descarta eventos enquanto a nota está em edição/envio; não existe fila para reaplicar o evento posteriormente.
- `migrateAnonymousToUserCache` mantém as notas anônimas, mas pode tentar migrá-las repetidamente. Precisamos de confirmação durável antes de limpar a origem.
- O histórico de conflitos é local, limitado e não substitui controle de revisões no servidor.

## Matriz de testes obrigatória
| Cenário | Resultado esperado |
| --- | --- |
| PC salva; celular/PWA online abre | Mesmo conteúdo e título |
| Celular salva; PC online abre | Mesmo conteúdo e título |
| Editar offline e fechar/reabrir | Edição local continua presente |
| Reconectar após edição offline | Edição sincroniza sem perda |
| Dois dispositivos editam o mesmo dia | Duas versões recuperáveis, sem perda silenciosa |
| Excluir offline e reconectar | Exclusão propagada sem ressurgimento |
| Falha de permissão no Firestore | Status não diz "sincronizado" |
| Estouro de quota local | Aviso explícito; edição não é tratada como salva |
| Atualizar PWA com cache antigo | Recursos atualizados após reconexão |
| Restaurar backup do trabalho | Contagem, links e comandos preservados |

## Sequência de implementação
1. Extrair lógica pura de comparação/merge e criar testes automatizados.
2. Introduzir revisões por anotação, identificador de dispositivo e fila de operações durável.
3. Implementar reconciliação idempotente e status real de sincronização.
4. Migrar UI gradualmente para módulos, sem alterar comportamento sem testes.
5. Validar em dois navegadores e no PWA antes do merge para `main`.
