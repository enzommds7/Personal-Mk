# Validação da migração de armazenamento (pré-main)

Estado: **bloqueada para merge** até testes em navegador.

## Diagnóstico do app.js

- `loadLocal()`, `saveLocal()`, `localSetDay()` e `allKeys()` ainda dependem de um único JSON síncrono no `localStorage`.
- `AgendaNotesBackupDB/snapshots` é um espelho assíncrono, **não** substitui a gravação principal; falha de quota continua impedindo o salvamento.
- O espelho não possui confirmação persistente de versão/checksum, nem caminho de escrita primária com leitura consistente.
- A recuperação atual só acontece quando a chave local inexiste. Se a chave existir com JSON inválido, a aplicação interrompe (corretamente), mas não oferece restauração orientada.
- `snapshotCurrentNotes()` pode falhar sem bloquear o salvamento local; portanto o espelho não é garantia de durabilidade.

## Critérios antes de publicar na main

1. Persistir cada alteração no IndexedDB como fonte principal; confirmar transação antes de comunicar sucesso.
2. Migrar a cópia legada sem apagar a chave original; validar contagem de dias, títulos, tarefas, tags e imagens.
3. Atualizar leitores síncronos via cache em memória inicializado **antes** de renderizar ou iniciar listeners remotos.
4. Serializar alterações, impedir sobrescrita de versões recentes e testar edição simultânea/reabertura.
5. Exportação JSON continua idêntica; importação do backup do PC da empresa funciona integralmente.
6. Simular quota excedida no localStorage, IndexedDB indisponível, recarga, offline, reconexão e login/logout.
7. Validar no Chrome desktop e Safari iOS. Não enviar dados pessoais de teste ao repositório.

Nenhuma alteração funcional desta branch deve ser integrada sem execução desses testes.
