-- Estado "Parado" para clientes: hubo oportunidad, pero se paró o no salió
-- (distinto de "Ex cliente", que es quien fue cliente y ya no lo es).
alter table clients drop constraint if exists clients_status_check;
alter table clients add constraint clients_status_check
  check (status in ('lead', 'prospect', 'client', 'paused', 'former'));

-- Mònica Guilera y AM Reformas nunca llegaron a ser clientes: pasan a Parado
update clients set status = 'paused' where name in ('Mònica Guilera', 'AM Reformas');

select name, status from clients order by status, name;
