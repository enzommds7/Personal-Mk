# Backend PersonalMk — contrato de sincronização (proposta de implementação)

## Fonte da verdade
Firebase Authentication identifica o usuário (UID). Firestore armazena `users/{uid}/days/{YYYY-MM-DD}`. O IndexedDB guarda cache e fila de operações por UID; localStorage legado é somente origem para migração, não fonte de verdade depois do corte.

## Migração inicial — operação protegida
1. Manter o JSON exportado do PC da empresa fora do GitHub e verificar que é legível e completo.
2. Bloquear uploads automáticos de caches antigos nos três dispositivos até a migração ser confirmada.
3. Pré-visualizar contagem de dias, notas e imagens do JSON e confirmar o UID autenticado.
4. Fazer upload em lotes com identificador de migração e progresso; não apagar origem.
5. Ler novamente do servidor, comparar chaves e conteúdo (hashes), só então ativar leitura normal nos outros dispositivos.
6. Não apagar documentos remotos até existir backup e confirmação explícita.

## API lógica do repositório de notas
- `listDays(uid)`: leitura do servidor para hidratação inicial.
- `watchDays(uid)`: listener remoto, incluindo exclusões (tombstones).
- `putDay(uid, day, payload, opId, baseVersion)`: gravação autenticada, idempotente, versão monotônica; conflito explícito.
- `deleteDay(uid, day, opId, baseVersion)`: tombstone, nunca remoção silenciosa.
- `flushQueue(uid)`: reenvia operações pendentes na ordem, com retry exponencial; confirma apenas após ack remoto.
- `importBackup(uid, json)`: migração com validação e verificação pós-escrita, não acionada automaticamente.

## Regras de segurança
Regras do Firestore: acesso permitido somente quando `request.auth.uid == uid`, com validação de tamanho, tipos e campos. Não colocar credenciais nem JSON pessoal no repositório. Imagens grandes devem migrar para Firebase Storage (caminho por UID) em vez de base64 dentro de um documento Firestore.

## Testes mínimos antes de merge
- Criar/editar no PC e observar no celular após reconectar e recarregar.
- Editar offline e confirmar envio posterior.
- Simular falha de permissão e quota: exibir erro e preservar fila.
- Verificar que dados antigos do celular não sobrescrevem o backup importado.
- Testar edição simultânea e exclusão sem ressurreição de notas.
- Comparar 100% das entradas importadas com o backup antes de declarar sucesso.

Estado: especificação de arquitetura. Ainda não implementado nem validado no navegador.
